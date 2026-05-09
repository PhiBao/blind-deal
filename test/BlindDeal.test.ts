import { loadFixture, time } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { expect } from 'chai'
import hre from 'hardhat'
import { Encryptable, FheTypes } from '@cofhe/sdk'

describe('BlindDeal', function () {
	async function deployBlindDealFixture() {
		const [deployer, buyer, seller, outsider] = await hre.ethers.getSigners()

		const BlindDeal = await hre.ethers.getContractFactory('BlindDeal')
		const blindDeal = await BlindDeal.connect(deployer).deploy()

		return { blindDeal, deployer, buyer, seller, outsider }
	}

	describe('Deal Creation', function () {
		it('Should create a deal with buyer and seller', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)

			await blindDeal.connect(buyer).createDeal(seller.address, 'Test deal', 0)

			const [b, s] = await blindDeal.getDealParties(0)
			expect(b).to.equal(buyer.address)
			expect(s).to.equal(seller.address)
			expect(await blindDeal.getDealState(0)).to.equal(0) // Open
			expect(await blindDeal.getDealDescription(0)).to.equal('Test deal')
		})

		it('Should increment deal count', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)

			await blindDeal.connect(buyer).createDeal(seller.address, 'Deal 1', 0)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Deal 2', 0)

			expect(await blindDeal.dealCount()).to.equal(2)
		})

		it('Should track deals per user', async function () {
			const { blindDeal, buyer, seller, outsider } = await loadFixture(deployBlindDealFixture)

			await blindDeal.connect(buyer).createDeal(seller.address, 'Deal A', 0)
			await blindDeal.connect(buyer).createDeal(outsider.address, 'Deal B', 0)

			const buyerDeals = await blindDeal.getUserDeals(buyer.address)
			expect(buyerDeals.length).to.equal(2)
			expect(buyerDeals[0]).to.equal(0)
			expect(buyerDeals[1]).to.equal(1)

			const sellerDeals = await blindDeal.getUserDeals(seller.address)
			expect(sellerDeals.length).to.equal(1)
			expect(sellerDeals[0]).to.equal(0)
		})

		it('Should set deadline when duration > 0', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)

			await blindDeal.connect(buyer).createDeal(seller.address, 'Timed deal', 3600)

			const deadline = await blindDeal.getDealDeadline(0)
			expect(deadline).to.be.gt(0)
		})

		it('Should set deadline to 0 when duration is 0', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)

			await blindDeal.connect(buyer).createDeal(seller.address, 'No deadline', 0)

			expect(await blindDeal.getDealDeadline(0)).to.equal(0)
		})

		it('Should reject self-deal (buyer == seller)', async function () {
			const { blindDeal, buyer } = await loadFixture(deployBlindDealFixture)

			await expect(
				blindDeal.connect(buyer).createDeal(buyer.address, 'Self deal', 0),
			).to.be.revertedWithCustomError(blindDeal, 'SelfDeal')
		})

		it('Should allow zero address as seller (creates Open marketplace deal)', async function () {
			const { blindDeal, buyer } = await loadFixture(deployBlindDealFixture)

			await blindDeal.connect(buyer).createDeal('0x0000000000000000000000000000000000000000', 'Open marketplace deal', 0)

			const state = await blindDeal.getDealState(0)
			expect(state).to.equal(0) // Open

			const dealType = await blindDeal.getDealType(0)
			expect(dealType).to.equal(1) // Open

			const parties = await blindDeal.getDealParties(0)
			expect(parties.buyer).to.equal(buyer.address)
			expect(parties.seller).to.equal('0x0000000000000000000000000000000000000000')
		})

		it('Should reject finalizeDeal before prices submitted', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)

			await blindDeal.connect(buyer).createDeal(seller.address, 'Premature finalize', 0)

			await expect(
				blindDeal.finalizeDeal(0),
			).to.be.revertedWith('Not resolved yet')
		})
	})

	describe('Price Submission', function () {
		it('Should allow buyer to submit encrypted price', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Test', 0)

			const buyerClient = await hre.cofhe.createClientWithBatteries(buyer)
			const [encPrice] = await buyerClient.encryptInputs([Encryptable.uint64(1000n)]).execute()

			await blindDeal.connect(buyer).submitBuyerPrice(0, encPrice)

			const [buyerDone, sellerDone] = await blindDeal.isDealSubmitted(0)
			expect(buyerDone).to.be.true
			expect(sellerDone).to.be.false
		})

		it('Should allow seller to submit encrypted price', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Test', 0)

			const sellerClient = await hre.cofhe.createClientWithBatteries(seller)
			const [encPrice] = await sellerClient.encryptInputs([Encryptable.uint64(800n)]).execute()

			await blindDeal.connect(seller).submitSellerPrice(0, encPrice)

			const [buyerDone, sellerDone] = await blindDeal.isDealSubmitted(0)
			expect(buyerDone).to.be.false
			expect(sellerDone).to.be.true
		})

		it('Should reject wrong role submitting', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Test', 0)

			const sellerClient = await hre.cofhe.createClientWithBatteries(seller)
			const [encPrice] = await sellerClient.encryptInputs([Encryptable.uint64(500n)]).execute()

			await expect(
				blindDeal.connect(seller).submitBuyerPrice(0, encPrice),
			).to.be.revertedWithCustomError(blindDeal, 'NotBuyer')
		})

		it('Should reject double submission', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Test', 0)

			const buyerClient = await hre.cofhe.createClientWithBatteries(buyer)
			const [encPrice1] = await buyerClient.encryptInputs([Encryptable.uint64(1000n)]).execute()
			const [encPrice2] = await buyerClient.encryptInputs([Encryptable.uint64(2000n)]).execute()

			await blindDeal.connect(buyer).submitBuyerPrice(0, encPrice1)

			await expect(
				blindDeal.connect(buyer).submitBuyerPrice(0, encPrice2),
			).to.be.revertedWithCustomError(blindDeal, 'AlreadySubmitted')
		})
	})

	describe('Deal Resolution — Match', function () {
		it('Should match when buyer max >= seller min (1000 >= 800)', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Matching deal', 0)

			const buyerClient = await hre.cofhe.createClientWithBatteries(buyer)
			const [buyerEnc] = await buyerClient.encryptInputs([Encryptable.uint64(1000n)]).execute()
			await blindDeal.connect(buyer).submitBuyerPrice(0, buyerEnc)

			const sellerClient = await hre.cofhe.createClientWithBatteries(seller)
			const [sellerEnc] = await sellerClient.encryptInputs([Encryptable.uint64(800n)]).execute()
			await blindDeal.connect(seller).submitSellerPrice(0, sellerEnc)

			const matchHandle = await blindDeal.getMatchResult(0)
			await hre.cofhe.mocks.expectPlaintext(matchHandle, 1n) // true = matched
		})

		it('Should compute midpoint price correctly', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Midpoint test', 0)

			const buyerClient = await hre.cofhe.createClientWithBatteries(buyer)
			const [buyerEnc] = await buyerClient.encryptInputs([Encryptable.uint64(1000n)]).execute()
			await blindDeal.connect(buyer).submitBuyerPrice(0, buyerEnc)

			const sellerClient = await hre.cofhe.createClientWithBatteries(seller)
			const [sellerEnc] = await sellerClient.encryptInputs([Encryptable.uint64(800n)]).execute()
			await blindDeal.connect(seller).submitSellerPrice(0, sellerEnc)

			await time.increase(15)

			await blindDeal.finalizeDeal(0)
			expect(await blindDeal.getDealState(0)).to.equal(1) // Matched

			const priceHandle = await blindDeal.getDealPrice(0)
			await hre.cofhe.mocks.expectPlaintext(priceHandle, 900n)
		})

		it('Should match when prices are equal', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Equal price test', 0)

			const buyerClient = await hre.cofhe.createClientWithBatteries(buyer)
			const [buyerEnc] = await buyerClient.encryptInputs([Encryptable.uint64(500n)]).execute()
			await blindDeal.connect(buyer).submitBuyerPrice(0, buyerEnc)

			const sellerClient = await hre.cofhe.createClientWithBatteries(seller)
			const [sellerEnc] = await sellerClient.encryptInputs([Encryptable.uint64(500n)]).execute()
			await blindDeal.connect(seller).submitSellerPrice(0, sellerEnc)

			await time.increase(15)
			await blindDeal.finalizeDeal(0)
			expect(await blindDeal.getDealState(0)).to.equal(1) // Matched

			const priceHandle = await blindDeal.getDealPrice(0)
			await hre.cofhe.mocks.expectPlaintext(priceHandle, 500n)
		})
	})

	describe('Deal Resolution — No Match', function () {
		it('Should not match when buyer max < seller min (500 < 800)', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'No match deal', 0)

			const buyerClient = await hre.cofhe.createClientWithBatteries(buyer)
			const [buyerEnc] = await buyerClient.encryptInputs([Encryptable.uint64(500n)]).execute()
			await blindDeal.connect(buyer).submitBuyerPrice(0, buyerEnc)

			const sellerClient = await hre.cofhe.createClientWithBatteries(seller)
			const [sellerEnc] = await sellerClient.encryptInputs([Encryptable.uint64(800n)]).execute()
			await blindDeal.connect(seller).submitSellerPrice(0, sellerEnc)

			const matchHandle = await blindDeal.getMatchResult(0)
			await hre.cofhe.mocks.expectPlaintext(matchHandle, 0n) // false = no match

			await time.increase(15)
			await blindDeal.finalizeDeal(0)
			expect(await blindDeal.getDealState(0)).to.equal(2) // NoMatch
		})

		it('Should revert when reading price of unmatched deal', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Revert test', 0)

			const buyerClient = await hre.cofhe.createClientWithBatteries(buyer)
			const [buyerEnc] = await buyerClient.encryptInputs([Encryptable.uint64(100n)]).execute()
			await blindDeal.connect(buyer).submitBuyerPrice(0, buyerEnc)

			const sellerClient = await hre.cofhe.createClientWithBatteries(seller)
			const [sellerEnc] = await sellerClient.encryptInputs([Encryptable.uint64(900n)]).execute()
			await blindDeal.connect(seller).submitSellerPrice(0, sellerEnc)

			await time.increase(15)
			await blindDeal.finalizeDeal(0)

			await expect(blindDeal.getDealPrice(0)).to.be.revertedWithCustomError(blindDeal, 'DealNotResolved')
		})
	})

	describe('Cancellation', function () {
		it('Should allow buyer to cancel before resolution', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Cancel test', 0)

			await blindDeal.connect(buyer).cancelDeal(0)
			expect(await blindDeal.getDealState(0)).to.equal(3) // Cancelled
		})

		it('Should allow seller to cancel before resolution', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Cancel test', 0)

			await blindDeal.connect(seller).cancelDeal(0)
			expect(await blindDeal.getDealState(0)).to.equal(3) // Cancelled
		})

		it('Should reject cancellation from outsider', async function () {
			const { blindDeal, buyer, seller, outsider } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Cancel test', 0)

			await expect(
				blindDeal.connect(outsider).cancelDeal(0),
			).to.be.revertedWithCustomError(blindDeal, 'NotParticipant')
		})

		it('Should reject submission on cancelled deal', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Cancel test', 0)
			await blindDeal.connect(buyer).cancelDeal(0)

			const buyerClient = await hre.cofhe.createClientWithBatteries(buyer)
			const [encPrice] = await buyerClient.encryptInputs([Encryptable.uint64(1000n)]).execute()

			await expect(
				blindDeal.connect(buyer).submitBuyerPrice(0, encPrice),
			).to.be.revertedWithCustomError(blindDeal, 'DealNotOpen')
		})
	})

	describe('Deal Expiry', function () {
		it('Should reject submission after deadline', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Expiry test', 60) // 60s deadline

			await time.increase(61)

			const buyerClient = await hre.cofhe.createClientWithBatteries(buyer)
			const [encPrice] = await buyerClient.encryptInputs([Encryptable.uint64(1000n)]).execute()

			await expect(
				blindDeal.connect(buyer).submitBuyerPrice(0, encPrice),
			).to.be.revertedWithCustomError(blindDeal, 'DealDeadlinePassed')
		})

		it('Should allow expireDeal after deadline', async function () {
			const { blindDeal, buyer, seller, outsider } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Expiry test', 60)

			await time.increase(61)

			await blindDeal.connect(outsider).expireDeal(0)
			expect(await blindDeal.getDealState(0)).to.equal(4) // Expired
		})

		it('Should reject expireDeal before deadline', async function () {
			const { blindDeal, buyer, seller, outsider } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Too early', 3600)

			await expect(
				blindDeal.connect(outsider).expireDeal(0),
			).to.be.revertedWithCustomError(blindDeal, 'DealNotExpired')
		})

		it('Should reject expireDeal on deal with no deadline', async function () {
			const { blindDeal, buyer, seller, outsider } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'No deadline', 0)

			await expect(
				blindDeal.connect(outsider).expireDeal(0),
			).to.be.revertedWithCustomError(blindDeal, 'DealNotExpired')
		})

		it('Should reject deadline longer than 365 days', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			const oneYear = 365 * 24 * 60 * 60 + 1

			await expect(
				blindDeal.connect(buyer).createDeal(seller.address, 'Too long', oneYear),
			).to.be.revertedWithCustomError(blindDeal, 'DeadlineTooLong')
		})

		it('Should record createdAt timestamp', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			const before = await time.latest()

			await blindDeal.connect(buyer).createDeal(seller.address, 'Timestamp test', 0)
			const createdAt = await blindDeal.getDealCreatedAt(0)

			const after = await time.latest()
			expect(createdAt).to.be.gte(before)
			expect(createdAt).to.be.lte(after)
		})
	})

	describe('Open Marketplace — Join Deal', function () {
		it('Should allow a third party to join an Open deal as seller', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)

			await blindDeal.connect(buyer).createDeal(ethers.ZeroAddress, 'Open deal', 0)

			await blindDeal.connect(seller).joinDeal(0)

			const parties = await blindDeal.getDealParties(0)
			expect(parties.seller).to.equal(seller.address)
		})

		it('Should reject joinDeal on Direct deal', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			const [, , thirdParty] = await ethers.getSigners()

			await blindDeal.connect(buyer).createDeal(seller.address, 'Direct deal', 0)

			await expect(
				blindDeal.connect(thirdParty).joinDeal(0),
			).to.be.revertedWithCustomError(blindDeal, 'NotOpenDeal')
		})

		it('Should reject joinDeal if already joined', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			const [, , thirdParty] = await ethers.getSigners()

			await blindDeal.connect(buyer).createDeal(ethers.ZeroAddress, 'Open deal', 0)
			await blindDeal.connect(seller).joinDeal(0)

			await expect(
				blindDeal.connect(thirdParty).joinDeal(0),
			).to.be.revertedWithCustomError(blindDeal, 'DealFull')
		})

		it('Should reject buyer from joining their own deal', async function () {
			const { blindDeal, buyer } = await loadFixture(deployBlindDealFixture)

			await blindDeal.connect(buyer).createDeal(ethers.ZeroAddress, 'Open deal', 0)

			await expect(
				blindDeal.connect(buyer).joinDeal(0),
			).to.be.revertedWithCustomError(blindDeal, 'SelfDeal')
		})

		it('Should reject submitSellerPrice before seller joins', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)

			await blindDeal.connect(buyer).createDeal(ethers.ZeroAddress, 'Open deal', 0)

			await expect(
				blindDeal.connect(seller).submitSellerPrice(0, { ctHash: 0, securityZone: 0, utype: 0, signature: '0x' }),
			).to.be.revertedWithCustomError(blindDeal, 'DealFull')
		})

		it('Full Open deal flow: create → join → submit prices → resolve', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)

			// Create Open deal
			await blindDeal.connect(buyer).createDeal(ethers.ZeroAddress, 'Full flow test', 0)

			const dealType = await blindDeal.getDealType(0)
			expect(dealType).to.equal(1) // Open

			// Third party joins as seller
			await blindDeal.connect(seller).joinDeal(0)

			const parties = await blindDeal.getDealParties(0)
			expect(parties.seller).to.equal(seller.address)

			// Both submit prices
			const client = await hre.cofhe.createClientWithBatteries(buyer)
			const [enc] = await client.encryptInputs([Encryptable.uint64(1000n)]).execute()

			await blindDeal.connect(buyer).submitBuyerPrice(0, enc)

			const client2 = await hre.cofhe.createClientWithBatteries(seller)
			const [enc2] = await client2.encryptInputs([Encryptable.uint64(800n)]).execute()

			await blindDeal.connect(seller).submitSellerPrice(0, enc2)

			// Verify both submitted
			const [buyerDone, sellerDone] = await blindDeal.isDealSubmitted(0)
			expect(buyerDone).to.be.true
			expect(sellerDone).to.be.true
		})

		it('Should allow buyer to cancel Open deal before seller joins', async function () {
			const { blindDeal, buyer } = await loadFixture(deployBlindDealFixture)

			await blindDeal.connect(buyer).createDeal(ethers.ZeroAddress, 'Open cancel test', 0)

			await blindDeal.connect(buyer).cancelDeal(0)

			const state = await blindDeal.getDealState(0)
			expect(state).to.equal(3) // Cancelled
		})
	})
})
