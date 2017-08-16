const JincorToken = artifacts.require("JincorToken");
const JincorTokenPreSale = artifacts.require("JincorTokenPreSale");
const assertJump = require("zeppelin-solidity/test/helpers/assertJump.js");

const hardCap = 700 * 10 ** 18; //in USD
const softCap = 500;
const limit = 250;
const beneficiary = web3.eth.accounts[0];
const ethUsdPrice = 250;

async function advanceToBlock(number) {
  if (web3.eth.blockNumber > number) {
    throw Error(`block number ${number} is in the past (current is ${web3.eth.blockNumber})`)
  }

  while (web3.eth.blockNumber < number) {
    await web3.eth.sendTransaction({value: 1, from: web3.eth.accounts[8], to: web3.eth.accounts[7]});
  }
}

contract('JincorTokenPresale', function (accounts) {
  beforeEach(async function () {
    this.startBlock = web3.eth.blockNumber;
    this.endBlock = web3.eth.blockNumber + 10;

    this.token = await JincorToken.new();
    const totalTokens = web3.toWei(2800, "ether");

    this.crowdsale = await JincorTokenPreSale.new(hardCap, softCap, this.token.address, beneficiary, totalTokens, ethUsdPrice, limit, this.startBlock, this.endBlock);
    this.token.setTransferAgent(this.token.address, true);
    this.token.setTransferAgent(this.crowdsale.address, true);
    this.token.setTransferAgent(accounts[0], true);
    this.token.transfer(this.crowdsale.address, web3.toWei(2800, "ether"));
  });

  it('should send tokens to purchaser', async function () {
    await this.crowdsale.sendTransaction({value: 1 * 10 ** 18, from: accounts[2]});

    const balance = await this.token.balanceOf(accounts[2]);
    assert.equal(balance.valueOf(), 1000 * 10 ** 18);

    const crowdsaleBalance = await this.token.balanceOf(this.crowdsale.address);
    assert.equal(crowdsaleBalance.valueOf(), 1800 * 10 ** 18);

    const collected = await this.crowdsale.collected();
    assert.equal(collected.valueOf(), 1 * 10 ** 18);

    const investorCount = await this.crowdsale.investorCount();
    assert.equal(investorCount, 1);

    const tokensSold = await this.crowdsale.tokensSold();
    assert.equal(tokensSold.valueOf(), 1000 * 10 ** 18);
  });

  it('should not allow to send less than 0.1 ETH', async function () {
    try {
      await this.crowdsale.sendTransaction({value: 0.0999 * 10 ** 18, from: accounts[2]});
    } catch (error) {
      return assertJump(error);
    }
    assert.fail('should have thrown before');
  });

  it('should not allow to exceed purchase limit with 1 purchase', async function () {
    const amount = ((limit / ethUsdPrice) + 1) * 10 ** 18;

    try {
      await this.crowdsale.sendTransaction({value: amount, from: accounts[2]});
    } catch (error) {
      return assertJump(error);
    }
    assert.fail('should have thrown before');
  });

  it('should not allow to exceed purchase limit with 2 purchases', async function () {
    await this.crowdsale.sendTransaction({value: 0.9 * 10 ** 18, from: accounts[2]});

    try {
      await this.crowdsale.sendTransaction({value: 0.11 * 10 ** 18, from: accounts[2]});
    } catch (error) {
      return assertJump(error);
    }
    assert.fail('should have thrown before');
  });

  it('should set flag when softcap is reached', async function () {
    await this.crowdsale.sendTransaction({value: 1 * 10 ** 18, from: accounts[1]});
    await this.crowdsale.sendTransaction({value: 1 * 10 ** 18, from: accounts[2]});

    const softCapReached = await this.crowdsale.softCapReached();
    assert.equal(softCapReached, true);
  });

  it('should not allow to exceed hard cap', async function () {
    await this.crowdsale.sendTransaction({value: 1 * 10 ** 18, from: accounts[1]});
    await this.crowdsale.sendTransaction({value: 1 * 10 ** 18, from: accounts[2]});

    try {
      await this.crowdsale.sendTransaction({value: 1 * 10 ** 18, from: accounts[3]});
    } catch (error) {
      return assertJump(error);
    }
    assert.fail('should have thrown before');
  });

  it('should allow withdraw only for owner', async function () {
    try {
      await this.crowdsale.withdraw({from: accounts[1]});
    } catch (error) {
      return assertJump(error);
    }
    assert.fail('should have thrown before');
  });

  it('should not allow withdraw when softcap is not reached', async function () {
    await this.crowdsale.sendTransaction({value: 1 * 10 ** 18, from: accounts[1]});

    try {
      await this.crowdsale.withdraw();
    } catch (error) {
      return assertJump(error);
    }
    assert.fail('should have thrown before');
  });

  it('should withdraw - send all not distributed tokens and collected ETH to beneficiary', async function () {
    await this.crowdsale.sendTransaction({value: 1 * 10 ** 18, from: accounts[1]});
    await this.crowdsale.sendTransaction({value: 1 * 10 ** 18, from: accounts[2]});

    const oldBenBalanceEth = web3.eth.getBalance(beneficiary);
    const oldBenBalanceJcr = await this.token.balanceOf(beneficiary).valueOf();

    await this.crowdsale.withdraw();

    const newBenBalanceEth = web3.eth.getBalance(beneficiary);
    const newBenBalanceJcr = await this.token.balanceOf(beneficiary).valueOf();
    const preSaleContractBalanceJcr = await this.token.balanceOf(this.crowdsale.address).valueOf();
    const preSaleContractBalanceEth = web3.eth.getBalance(this.crowdsale.address);

    assert.equal(newBenBalanceEth > oldBenBalanceEth, true);
    assert.equal(newBenBalanceJcr > oldBenBalanceJcr, true);
    assert.equal(preSaleContractBalanceJcr, 0);
    assert.equal(preSaleContractBalanceEth, 0);
  });

  it('should not allow purchase if pre sale is ended', async function () {
    while (web3.eth.blockNumber < this.endBlock) {
      await this.crowdsale.sendTransaction({value: 0.1 * 10 ** 18, from: accounts[2]});
    }

    try {
      await this.crowdsale.sendTransaction({value: 0.1 * 10 ** 18, from: accounts[2]});
    } catch (error) {
      return assertJump(error);
    }
    assert.fail('should have thrown before');
  });

  it('should not allow refund if pre sale is not ended', async function () {
    await this.crowdsale.sendTransaction({value: 1 * 10 ** 18, from: accounts[2]});

    try {
      await this.crowdsale.refund({from: accounts[2]});
    } catch (error) {
      return assertJump(error);
    }
    assert.fail('should have thrown before');
  });

  it('should not allow refund if cap is reached', async function () {
    await this.crowdsale.sendTransaction({value: 1 * 10 ** 18, from: accounts[1]});
    await this.crowdsale.sendTransaction({value: 1 * 10 ** 18, from: accounts[3]});

    await advanceToBlock(this.endBlock);

    try {
      await this.crowdsale.refund({from: accounts[2]});
    } catch (error) {
      return assertJump(error);
    }
    assert.fail('should have thrown before');
  });

  it('should refund if cap is not reached and pre sale is ended', async function () {
    await this.crowdsale.sendTransaction({value: 0.1 * 10 ** 18, from: accounts[2]});

    await advanceToBlock(this.endBlock);

    const balanceBefore = web3.eth.getBalance(accounts[2]);
    await this.crowdsale.refund({from: accounts[2]});

    const balanceAfter = web3.eth.getBalance(accounts[2]);

    assert.equal(balanceAfter > balanceBefore, true);

    const weiRefunded = await this.crowdsale.weiRefunded();
    assert.equal(weiRefunded, 0.1 * 10 ** 18);

    //should not refund 1 more time
    try {
      await this.crowdsale.refund({from: accounts[2]});
    } catch (error) {
      return assertJump(error);
    }
    assert.fail('should have thrown before');
  });
});
