import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { BlindDeal } from '../typechain-types'
import { cofhejs, FheTypes } from 'cofhejs/node'
import { cofhejs_initializeWithHardhatSigner } from 'cofhe-hardhat-plugin'
import { getDeployment } from './utils'

task('finalize-deal', 'Finalize a deal after FHE resolution')
	.addParam('deal', 'The deal ID')
	.setAction(async (taskArgs: { deal: string }, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre

		const address = getDeployment(network.name, 'BlindDeal')
		if (!address) {
			console.error(`No BlindDeal deployment found.`)
			return
		}

		const [signer] = await ethers.getSigners()
		console.log(`Finalizing deal as: ${signer.address}`)
		await cofhejs_initializeWithHardhatSigner(signer)

		const BlindDeal = await ethers.getContractFactory('BlindDeal')
		const blindDeal = BlindDeal.attach(address) as unknown as BlindDeal

		const dealId = BigInt(taskArgs.deal)

		const tx = await blindDeal.finalizeDeal(dealId)
		await tx.wait()
		console.log(`Deal finalized. Transaction: ${tx.hash}`)

		const state = await blindDeal.getDealState(dealId)
		const stateNames = ['Open', 'Matched', 'NoMatch', 'Cancelled']
		console.log(`Deal state: ${stateNames[Number(state)]}`)

		if (Number(state) === 1) {
			// Matched — try to unseal deal price
			console.log('Deal matched! Unsealing deal price...')
			const priceHandle = await blindDeal.getDealPrice(dealId)
			const unsealed = await cofhejs.unseal(priceHandle, FheTypes.Uint64)
			console.log(`Deal price:`, unsealed)
		} else {
			console.log('No match — neither price was revealed. Privacy preserved.')
		}
	})
