import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { getDeployment } from './utils'

task('verify-blinddeal', 'Verify BlindDeal contract on Etherscan/Arbiscan')
	.setAction(async (_, hre: HardhatRuntimeEnvironment) => {
		const { network, run } = hre

		const address = getDeployment(network.name, 'BlindDeal')
		if (!address) {
			console.error(`No BlindDeal deployment found for ${network.name}`)
			return
		}

		console.log(`Verifying BlindDeal at ${address} on ${network.name}...`)

		try {
			await run('verify:verify', {
				address,
				constructorArguments: [],
			})
			console.log('BlindDeal verified successfully')
		} catch (err) {
			console.error('Verification failed:', err)
		}
	})

task('verify-resolver', 'Verify BlindDealResolver contract on Etherscan/Arbiscan')
	.setAction(async (_, hre: HardhatRuntimeEnvironment) => {
		const { network, run } = hre

		const resolverAddress = getDeployment(network.name, 'BlindDealResolver')
		const blindDealAddress = getDeployment(network.name, 'BlindDeal')

		if (!resolverAddress) {
			console.error(`No BlindDealResolver deployment found for ${network.name}`)
			return
		}
		if (!blindDealAddress) {
			console.error(`No BlindDeal deployment found for ${network.name} — required for resolver verification`)
			return
		}

		console.log(`Verifying BlindDealResolver at ${resolverAddress} on ${network.name}...`)
		console.log(`  Linked BlindDeal: ${blindDealAddress}`)

		try {
			await run('verify:verify', {
				address: resolverAddress,
				constructorArguments: [blindDealAddress],
			})
			console.log('BlindDealResolver verified successfully')
		} catch (err) {
			console.error('Verification failed:', err)
		}
	})
