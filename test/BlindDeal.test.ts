import { loadFixture, time } from '@nomicfoundation/hardhat-toolbox/network-helpers'
import { expect } from 'chai'
import hre from 'hardhat'
import { cofhejs, Encryptable, FheTypes } from 'cofhejs/node'

describe('BlindDeal', function () {
	async function deployBlindDealFixture() {
		const [deployer, buyer, seller, outsider] = await hre.ethers.getSigners()

		const BlindDeal = await hre.ethers.getContractFactory('BlindDeal')
		const blindDeal = await BlindDeal.connect(deployer).deploy()

		return { blindDeal, deployer, buyer, seller, outsider }
	}

	describe('Deal Creation', function () {
		beforeEach(function () {
			if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
		})

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

		it('Should reject zero address as seller', async function () {
			const { blindDeal, buyer } = await loadFixture(deployBlindDealFixture)

			await expect(
				blindDeal.connect(buyer).createDeal('0x0000000000000000000000000000000000000000', 'Zero seller', 0),
			).to.be.revertedWithCustomError(blindDeal, 'ZeroAddress')
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
		beforeEach(function () {
			if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
		})

		it('Should allow buyer to submit encrypted price', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Test', 0)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))
			const [encPrice] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(1000n)] as const))

			await blindDeal.connect(buyer).submitBuyerPrice(0, encPrice)

			const [buyerDone, sellerDone] = await blindDeal.isDealSubmitted(0)
			expect(buyerDone).to.be.true
			expect(sellerDone).to.be.false
		})

		it('Should allow seller to submit encrypted price', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Test', 0)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(seller))
			const [encPrice] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(800n)] as const))

			await blindDeal.connect(seller).submitSellerPrice(0, encPrice)

			const [buyerDone, sellerDone] = await blindDeal.isDealSubmitted(0)
			expect(buyerDone).to.be.false
			expect(sellerDone).to.be.true
		})

		it('Should reject wrong role submitting', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Test', 0)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(seller))
			const [encPrice] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(500n)] as const))

			await expect(
				blindDeal.connect(seller).submitBuyerPrice(0, encPrice),
			).to.be.revertedWithCustomError(blindDeal, 'NotBuyer')
		})

		it('Should reject double submission', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Test', 0)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))
			const [encPrice1] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(1000n)] as const))
			const [encPrice2] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(2000n)] as const))

			await blindDeal.connect(buyer).submitBuyerPrice(0, encPrice1)

			await expect(
				blindDeal.connect(buyer).submitBuyerPrice(0, encPrice2),
			).to.be.revertedWithCustomError(blindDeal, 'AlreadySubmitted')
		})
	})

	describe('Deal Resolution — Match', function () {
		beforeEach(function () {
			if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
		})

		it('Should match when buyer max >= seller min (1000 >= 800)', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Matching deal', 0)

			// Buyer submits max price = 1000
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))
			const [buyerEnc] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(1000n)] as const))
			await blindDeal.connect(buyer).submitBuyerPrice(0, buyerEnc)

			// Seller submits min price = 800
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(seller))
			const [sellerEnc] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(800n)] as const))
			await blindDeal.connect(seller).submitSellerPrice(0, sellerEnc)

			// Both submitted — resolution happened in submitSellerPrice
			// Verify match result via mock plaintext
			const matchHandle = await blindDeal.getMatchResult(0)
			await hre.cofhe.mocks.expectPlaintext(matchHandle, 1n) // true = matched
		})

		it('Should compute midpoint price correctly', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Midpoint test', 0)

			// Buyer = 1000, Seller = 800 → midpoint = 900
			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))
			const [buyerEnc] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(1000n)] as const))
			await blindDeal.connect(buyer).submitBuyerPrice(0, buyerEnc)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(seller))
			const [sellerEnc] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(800n)] as const))
			await blindDeal.connect(seller).submitSellerPrice(0, sellerEnc)

			// Advance time past mock decrypt delay
			await time.increase(15)

			// Finalize
			await blindDeal.finalizeDeal(0)
			expect(await blindDeal.getDealState(0)).to.equal(1) // Matched

			// Check deal price via mock — should be (1000 + 800) / 2 = 900
			const priceHandle = await blindDeal.getDealPrice(0)
			await hre.cofhe.mocks.expectPlaintext(priceHandle, 900n)
		})

		it('Should match when prices are equal', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Equal price test', 0)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))
			const [buyerEnc] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(500n)] as const))
			await blindDeal.connect(buyer).submitBuyerPrice(0, buyerEnc)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(seller))
			const [sellerEnc] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(500n)] as const))
			await blindDeal.connect(seller).submitSellerPrice(0, sellerEnc)

			await time.increase(15)
			await blindDeal.finalizeDeal(0)
			expect(await blindDeal.getDealState(0)).to.equal(1) // Matched

			const priceHandle = await blindDeal.getDealPrice(0)
			await hre.cofhe.mocks.expectPlaintext(priceHandle, 500n)
		})
	})

	describe('Deal Resolution — No Match', function () {
		beforeEach(function () {
			if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
		})

		it('Should not match when buyer max < seller min (500 < 800)', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'No match deal', 0)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))
			const [buyerEnc] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(500n)] as const))
			await blindDeal.connect(buyer).submitBuyerPrice(0, buyerEnc)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(seller))
			const [sellerEnc] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(800n)] as const))
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

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))
			const [buyerEnc] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(100n)] as const))
			await blindDeal.connect(buyer).submitBuyerPrice(0, buyerEnc)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(seller))
			const [sellerEnc] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(900n)] as const))
			await blindDeal.connect(seller).submitSellerPrice(0, sellerEnc)

			await time.increase(15)
			await blindDeal.finalizeDeal(0)

			await expect(blindDeal.getDealPrice(0)).to.be.revertedWithCustomError(blindDeal, 'DealNotResolved')
		})
	})

	describe('Cancellation', function () {
		beforeEach(function () {
			if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
		})

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

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))
			const [encPrice] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(1000n)] as const))

			await expect(
				blindDeal.connect(buyer).submitBuyerPrice(0, encPrice),
			).to.be.revertedWithCustomError(blindDeal, 'DealNotOpen')
		})
	})

	describe('Deal Expiry', function () {
		beforeEach(function () {
			if (!hre.cofhe.isPermittedEnvironment('MOCK')) this.skip()
		})

		it('Should reject submission after deadline', async function () {
			const { blindDeal, buyer, seller } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Expiry test', 60) // 60s deadline

			// Advance time past deadline
			await time.increase(61)

			await hre.cofhe.expectResultSuccess(hre.cofhe.initializeWithHardhatSigner(buyer))
			const [encPrice] = await hre.cofhe.expectResultSuccess(cofhejs.encrypt([Encryptable.uint64(1000n)] as const))

			await expect(
				blindDeal.connect(buyer).submitBuyerPrice(0, encPrice),
			).to.be.revertedWithCustomError(blindDeal, 'DealExpired')
		})

		it('Should allow expireDeal after deadline', async function () {
			const { blindDeal, buyer, seller, outsider } = await loadFixture(deployBlindDealFixture)
			await blindDeal.connect(buyer).createDeal(seller.address, 'Expiry test', 60)

			await time.increase(61)

			await blindDeal.connect(outsider).expireDeal(0)
			expect(await blindDeal.getDealState(0)).to.equal(3) // Cancelled
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
	})
})
