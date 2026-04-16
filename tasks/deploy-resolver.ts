import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment, getDeployment } from './utils'

task('deploy-resolver', 'Deploy the BlindDealResolver contract')
	.addOptionalParam('blinddeal', 'Address of the BlindDeal contract to link')
	.setAction(async (args: { blinddeal?: string }, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre

		// Resolve BlindDeal address: explicit arg > saved deployment
		const blindDealAddr = args.blinddeal ?? getDeployment(network.name, 'BlindDeal')
		if (!blindDealAddr) {
			throw new Error(
				`No BlindDeal address found for ${network.name}. Deploy BlindDeal first or pass --blinddeal <addr>.`
			)
		}

		console.log(`Deploying BlindDealResolver to ${network.name}...`)
		console.log(`  BlindDeal contract: ${blindDealAddr}`)

		const [deployer] = await ethers.getSigners()
		console.log(`  Deployer: ${deployer.address}`)

		const Resolver = await ethers.getContractFactory('BlindDealResolver')
		const resolver = await Resolver.deploy(blindDealAddr)
		await resolver.waitForDeployment()

		const address = await resolver.getAddress()
		console.log(`  BlindDealResolver deployed to: ${address}`)

		saveDeployment(network.name, 'BlindDealResolver', address)

		return address
	})
