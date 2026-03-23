import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment } from './utils'

task('deploy-blinddeal', 'Deploy the BlindDeal contract').setAction(async (_, hre: HardhatRuntimeEnvironment) => {
	const { ethers, network } = hre

	console.log(`Deploying BlindDeal to ${network.name}...`)

	const [deployer] = await ethers.getSigners()
	console.log(`Deploying with account: ${deployer.address}`)

	const BlindDeal = await ethers.getContractFactory('BlindDeal')
	const blindDeal = await BlindDeal.deploy()
	await blindDeal.waitForDeployment()

	const address = await blindDeal.getAddress()
	console.log(`BlindDeal deployed to: ${address}`)

	saveDeployment(network.name, 'BlindDeal', address)

	return address
})
