import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { BlindDeal } from '../typechain-types'
import { Encryptable } from '@cofhe/sdk'
import { getDeployment } from './utils'

task('submit-price', 'Submit an encrypted price to a deal')
	.addParam('deal', 'The deal ID')
	.addParam('price', 'Your price (plaintext — will be encrypted client-side)')
	.addParam('role', 'Your role: "buyer" or "seller"')
	.setAction(async (taskArgs: { deal: string; price: string; role: string }, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre

		const address = getDeployment(network.name, 'BlindDeal')
		if (!address) {
			console.error(`No BlindDeal deployment found.`)
			return
		}

		const [signer] = await ethers.getSigners()
		console.log(`Submitting ${taskArgs.role} price as: ${signer.address}`)

		const cofheClient = await hre.cofhe.createClientWithBatteries(signer)

		const BlindDeal = await ethers.getContractFactory('BlindDeal')
		const blindDeal = BlindDeal.attach(address) as unknown as BlindDeal

		const [encryptedValue] = await cofheClient
			.encryptInputs([Encryptable.uint64(BigInt(taskArgs.price))])
			.execute()

		const dealId = BigInt(taskArgs.deal)
		let tx

		if (taskArgs.role === 'buyer') {
			tx = await blindDeal.submitBuyerPrice(dealId, encryptedValue)
		} else if (taskArgs.role === 'seller') {
			tx = await blindDeal.submitSellerPrice(dealId, encryptedValue)
		} else {
			console.error('Role must be "buyer" or "seller"')
			return
		}

		await tx.wait()
		console.log(`Price submitted. Transaction: ${tx.hash}`)

		const [buyerDone, sellerDone] = await blindDeal.isDealSubmitted(dealId)
		console.log(`Buyer submitted: ${buyerDone}, Seller submitted: ${sellerDone}`)

		if (buyerDone && sellerDone) {
			console.log('Both prices submitted — deal is resolving via FHE...')
		}
	})
