import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { BlindDeal } from '../typechain-types'
import { Encryptable, FheTypes } from '@cofhe/sdk'
import { getDeployment } from './utils'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const STATE_NAMES = ['Open', 'Matched', 'NoMatch', 'Cancelled', 'Expired']

task('agent', 'AI Agent: discover deals, join, submit price, finalize')
	.addOptionalParam('price', 'Price to submit (plaintext — will be FHE encrypted)', '500')
	.addOptionalParam('mode', 'Mode: "discover" (find + join + submit), "create" (create Open deal + wait + submit), or "full" (create → join → submit → finalize)', 'discover')
	.setAction(async (taskArgs: { price: string; mode: string }, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre

		const address = getDeployment(network.name, 'BlindDeal')
		if (!address) {
			console.error('❌ No BlindDeal deployment found on this network.')
			return
		}

		const [signer] = await ethers.getSigners()
		const signerAddr = signer.address.toLowerCase()
		console.log(`🤖 Agent running as: ${signer.address}`)
		console.log(`📋 Network: ${network.name}`)
		console.log(`💰 Price: ${taskArgs.price} USDC`)
		console.log(`🎯 Mode: ${taskArgs.mode}`)
		console.log('─'.repeat(50))

		const BlindDealFactory = await ethers.getContractFactory('BlindDeal')
		const blindDeal = BlindDealFactory.attach(address) as unknown as BlindDeal
		const cofheClient = await hre.cofhe.createClientWithBatteries(signer)

		if (taskArgs.mode === 'create' || taskArgs.mode === 'full') {
			await createAndProcessDeal(blindDeal, cofheClient, signer, signerAddr, taskArgs.price, taskArgs.mode === 'full')
			return
		}

		// Default: discover mode
		await discoverAndJoinDeal(blindDeal, cofheClient, signer, signerAddr, taskArgs.price)
	})

async function discoverAndJoinDeal(
	blindDeal: BlindDeal,
	cofheClient: any,
	signer: any,
	signerAddr: string,
	price: string,
) {
	const count = await blindDeal.dealCount()
	console.log(`📊 Total deals on chain: ${count}`)

	if (count === 0n) {
		console.log('📭 No deals exist yet. Create one first with: npx hardhat create-deal --network arb-sepolia --seller 0x... --description "Test"')
		return
	}

	// Scan last 20 deals for open marketplace deals
	const scanLimit = Number(count > 20n ? 20n : count)
	let found = false

	for (let i = Number(count) - 1; i >= Math.max(0, Number(count) - scanLimit); i--) {
		const dealId = BigInt(i)
		const [state, parties, dealType] = await Promise.all([
			blindDeal.getDealState(dealId),
			blindDeal.getDealParties(dealId),
			blindDeal.getDealType(dealId),
		])

		if (Number(state) !== 0) continue // Not Open
		if (Number(dealType) !== 1) continue // Not Open marketplace
		if (parties.seller !== ZERO_ADDRESS) continue // Already has seller
		if (parties.buyer.toLowerCase() === signerAddr) continue // Can't join own deal

		console.log(`\n🎯 Found Open marketplace deal #${i}`)
		console.log(`   Buyer: ${parties.buyer}`)
		const desc = await blindDeal.getDealDescription(dealId)
		console.log(`   Description: ${desc}`)

		// Step 1: Join as seller
		console.log(`\n🤝 Joining deal #${i} as seller...`)
		const joinTx = await blindDeal.joinDeal(dealId)
		await joinTx.wait()
		console.log(`   ✅ Joined! Tx: ${joinTx.hash}`)

		// Step 2: Submit encrypted price
		console.log(`\n🔐 Encrypting price ${price} with FHE...`)
		const [encryptedValue] = await cofheClient
			.encryptInputs([Encryptable.uint64(BigInt(price))])
			.execute()

		console.log(`📝 Submitting seller price...`)
		const submitTx = await blindDeal.submitSellerPrice(dealId, encryptedValue)
		await submitTx.wait()
		console.log(`   ✅ Price submitted! Tx: ${submitTx.hash}`)

		// Check status
		const [buyerDone, sellerDone] = await blindDeal.isDealSubmitted(dealId)
		console.log(`\n📊 Status: Buyer=${buyerDone ? '✅' : '⏳'} Seller=${sellerDone ? '✅' : '⏳'}`)

		if (buyerDone && sellerDone) {
			console.log(`\n⚡ Both prices submitted — attempting finalize...`)
			try {
				const finalizeTx = await blindDeal.finalizeDeal(dealId)
				await finalizeTx.wait()
				const finalState = await blindDeal.getDealState(dealId)
				console.log(`   ✅ Finalized! State: ${STATE_NAMES[Number(finalState)]} Tx: ${finalizeTx.hash}`)

				if (Number(finalState) === 1) {
					const priceHandle = await blindDeal.getDealPrice(dealId)
					const dealPrice = await cofheClient
						.decryptForView(priceHandle, FheTypes.Uint64)
						.execute()
					console.log(`   💰 Deal price: ${dealPrice} USDC`)
				}
			} catch (err: any) {
				console.log(`   ⚠️  Finalize failed (may need client finalize): ${err.message?.slice(0, 80)}`)
				console.log(`   💡 Try: npx hardhat client-finalize --deal ${i} --matched true --network arb-sepolia`)
			}
		} else {
			console.log(`\n⏳ Waiting for other party to submit...`)
			console.log(`   💡 Run this agent again later to check status, or use:`)
			console.log(`   npx hardhat status --deal ${i} --network arb-sepolia`)
		}

		found = true
		break
	}

	if (!found) {
		console.log('\n🔍 No joinable Open marketplace deals found.')
		console.log('   💡 Create one first with:')
		console.log('   npx hardhat create-deal --network arb-sepolia --seller 0x0000000000000000000000000000000000000000 --description "Open deal"')
	}
}

async function createAndProcessDeal(
	blindDeal: BlindDeal,
	cofheClient: any,
	signer: any,
	signerAddr: string,
	price: string,
	full: boolean,
) {
	// Step 1: Create an Open marketplace deal
	console.log('\n🆕 Creating Open marketplace deal...')
	const createTx = await blindDeal.createDeal(ZERO_ADDRESS, `Agent deal — ${price} USDC`, 0)
	const receipt = await createTx.wait()

	// Extract deal ID from DealCreated event
	const event = receipt?.logs?.find((log: any) => {
		try {
			const parsed = blindDeal.interface.parseLog(log)
			return parsed?.name === 'DealCreated'
		} catch { return false }
	})

	let dealId = 0n
	if (event) {
		const parsed = blindDeal.interface.parseLog(event)
		dealId = parsed?.args?.dealId ?? 0n
	}

	console.log(`   ✅ Deal #${dealId} created! Tx: ${createTx.hash}`)
	console.log(`   🏪 Open for sellers to join`)

	if (!full) {
		console.log(`\n💡 To complete this deal, another wallet must:`)
		console.log(`   1. npx hardhat agent --mode discover --price ${price} --network arb-sepolia`)
		return
	}

	// Full mode: simulate being both buyer and seller (for demo)
	console.log(`\n🎭 Full demo mode — acting as both buyer and seller...`)

	// Step 2: Join as seller (same account for demo)
	console.log(`\n🤝 Joining as seller...`)
	const joinTx = await blindDeal.joinDeal(dealId)
	await joinTx.wait()
	console.log(`   ✅ Joined! Tx: ${joinTx.hash}`)

	// Step 3: Submit buyer price
	console.log(`\n🔐 Encrypting buyer price ${price}...`)
	const buyerPrice = BigInt(price)
	const [buyerEnc] = await cofheClient
		.encryptInputs([Encryptable.uint64(buyerPrice)])
		.execute()

	console.log(`📝 Submitting buyer price...`)
	const buyerTx = await blindDeal.submitBuyerPrice(dealId, buyerEnc)
	await buyerTx.wait()
	console.log(`   ✅ Buyer price submitted! Tx: ${buyerTx.hash}`)

	// Step 4: Submit seller price (slightly different for demo)
	const sellerPrice = buyerPrice - 50n // 50 less than buyer
	console.log(`\n🔐 Encrypting seller price ${sellerPrice}...`)
	const [sellerEnc] = await cofheClient
		.encryptInputs([Encryptable.uint64(sellerPrice)])
		.execute()

	console.log(`📝 Submitting seller price...`)
	const sellerTx = await blindDeal.submitSellerPrice(dealId, sellerEnc)
	await sellerTx.wait()
	console.log(`   ✅ Seller price submitted! Tx: ${sellerTx.hash}`)

	// Step 5: Finalize
	console.log(`\n⚡ Finalizing deal...`)
	try {
		const finalizeTx = await blindDeal.finalizeDeal(dealId)
		await finalizeTx.wait()
		const finalState = await blindDeal.getDealState(dealId)
		console.log(`   ✅ Finalized! State: ${STATE_NAMES[Number(finalState)]} Tx: ${finalizeTx.hash}`)

		if (Number(finalState) === 1) {
			const priceHandle = await blindDeal.getDealPrice(dealId)
			const dealPrice = await cofheClient
				.decryptForView(priceHandle, FheTypes.Uint64)
				.execute()
			console.log(`   💰 Deal price: ${dealPrice} USDC (midpoint of ${buyerPrice} and ${sellerPrice})`)
			console.log(`\n🎉 Deal matched! Both parties can see the midpoint price.`)
		} else {
			console.log(`\n❌ No match — buyer max (${buyerPrice}) < seller min (${sellerPrice})`)
			console.log(`   🔒 Neither price was revealed. Privacy preserved.`)
		}
	} catch (err: any) {
		console.log(`   ⚠️  Finalize error: ${err.message?.slice(0, 100)}`)
		console.log(`   💡 Try: npx hardhat client-finalize --deal ${dealId} --matched true --network arb-sepolia`)
	}

	console.log(`\n${'─'.repeat(50)}`)
	console.log(`📊 Summary:`)
	console.log(`   Deal: #${dealId}`)
	console.log(`   Buyer price: ${buyerPrice} (encrypted)`)
	console.log(`   Seller price: ${sellerPrice} (encrypted)`)
	console.log(`   Tx: ${createTx.hash}`)
}
