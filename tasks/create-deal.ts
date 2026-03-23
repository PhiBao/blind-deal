import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { BlindDeal } from '../typechain-types'
import { getDeployment } from './utils'

task('create-deal', 'Create a new BlindDeal negotiation')
	.addParam('seller', 'The seller address')
	.addOptionalParam('description', 'Deal description', 'BlindDeal negotiation')
	.addOptionalParam('duration', 'Deal deadline in seconds (0 = no deadline)', '0')
	.setAction(async (taskArgs: { seller: string; description: string; duration: string }, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre

		const address = getDeployment(network.name, 'BlindDeal')
		if (!address) {
			console.error(`No BlindDeal deployment found. Deploy first with: npx hardhat deploy-blinddeal --network ${network.name}`)
			return
		}

		const [signer] = await ethers.getSigners()
		console.log(`Creating deal as buyer: ${signer.address}`)
		console.log(`Seller: ${taskArgs.seller}`)

		const BlindDeal = await ethers.getContractFactory('BlindDeal')
		const blindDeal = BlindDeal.attach(address) as unknown as BlindDeal

		const tx = await blindDeal.createDeal(taskArgs.seller, taskArgs.description, BigInt(taskArgs.duration))
		const receipt = await tx.wait()
		console.log(`Transaction: ${tx.hash}`)

		const dealCount = await blindDeal.dealCount()
		const dealId = dealCount - 1n
		console.log(`Deal created with ID: ${dealId}`)
		if (BigInt(taskArgs.duration) > 0n) {
			console.log(`Deal expires in ${taskArgs.duration} seconds`)
		}
	})
