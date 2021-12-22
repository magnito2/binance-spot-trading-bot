const fs = require('fs');
const assert = require('assert').strict;
const { suite } = require('uvu');
import { addKlineRest } from '../server'
import { TickerPrice, Kline, CandlesRepo, addKlinesFromREST } from '../functions/utils'

let obj = JSON.parse(fs.readFileSync('./settings.json', 'utf8'));

const KlineTest = suite('Kline Class');

KlineTest.before.each(async context => {
    context.kline = new Kline(5000, 5500, 4900, 5400, 10000, Date.now() - 5000, Date.now())
})

KlineTest('Updates kline accordingly', async context => {
    const { kline } = context;
    assert.strictEqual(kline.open, 5000);
    assert.strictEqual(kline.high, 5500);
    assert.strictEqual(kline.low, 4900);
    assert.strictEqual(kline.close, 5400);
    assert.strictEqual(kline.vol, 10000);
    assert.ok(kline.openTime < kline.closeTime);
});

KlineTest.run();

const TickerPriceTest = suite('TickerPrice Class');

TickerPriceTest.before.each(async context => {
    context.ticker = new TickerPrice(5);
});

TickerPriceTest('Ticker Price tests', async context => {
    const { ticker } = context;
    assert.ok(!ticker.isUpdated());
    ticker.updatePrice({price: 5000, timestamp: Date.now()});
    assert.ok(ticker.isUpdated());
    assert.equal(ticker.getTickerPrice(), 5000);
});

TickerPriceTest('Window expires correctly', async () => {
    const ticker = new TickerPrice(0.5);
    ticker.updatePrice({price: 5000, timestamp: Date.now()});
    const start = Date.now();
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.ok(!ticker.isUpdated());
});

TickerPriceTest.run();

const CandlesRepoTest = suite('CandlesRepo class')

CandlesRepoTest.before(async context => {
    const klines = [];
    for(let i = 1; i < 6; i++ ){
        if(klines.length > 0){
            const lastKlineIndex = i - 2; //increment has already occured, last kline now at index i - 2
        }
        const k = new Kline(
                1000 + i * 5, 
                1000 + i * 15, 
                1000- i * 3, 
                1000 + i * 10, 
                1000 * i, 
                klines.length ? klines[i-2].closeTime : Date.now() - 1000, 
                klines.length ? klines[i-2].closeTime +1000 : Date.now()
            );
        klines.push(k);
    }
    context.repo = new CandlesRepo(5, [...klines]);
    context.raw = klines;
});

CandlesRepoTest('Maintains Size', async context => {
    const { repo } = context;
    assert.ok(!repo.isEmpty());
    assert.equal(repo.length(), 5)
});

CandlesRepoTest('Indexes correctly', async context => {
    const { repo, raw } = context;
    assert.deepEqual(repo.peek(1), raw[1])
    assert.deepEqual(repo.peek(0), raw[0])
    assert.deepEqual(repo.last(), raw[raw.length - 1]);
});

CandlesRepoTest('Adds a candles', async context => {
    const { repo, raw } = context;
    const k = new Kline(
        1000,
        1000 + 150, 
        1000- 300, 
        1000 + 100, 
        1000 * 5, 
        Date.now() + 100000, 
        Date.now() + 101000
    );
    assert.equal(repo.length(), 5);
    repo.add(k);
    assert.equal(repo.length(), 5);
    assert.deepEqual(repo.peek(0), raw[1]);
    assert.deepEqual(repo.last(), k);
});

CandlesRepoTest.run();

const addKlinesFromRESTTest = suite('Add klines from Rest');

const avgPrice30 = async (PAIR, settings) => {
    const respArr = [];
    for(let i=1; i < 31; i++){
        const resp = [
            respArr.length ? respArr[i-2][6] : Date.now() - 1000, 
            1000 * (i+1),
            1000 * (i + 2.5),
            1000 * (i + 0.5),
            1000 * (i+2),
            10000 * Math.random(),
            respArr.length ? respArr[i-2][6] +1000 : Date.now()
        ];
        respArr.push(resp);
    }
    return respArr;
}

addKlinesFromRESTTest.before(async context => {
    context.rawData = await avgPrice30('USDBTC', {});
    context.repo = new CandlesRepo(30);
});

addKlinesFromRESTTest('fetches correctly', async context => {
    const { rawData, repo } = context;
    const kFromRest = addKlinesFromREST(repo);
    await kFromRest(rawData);
    assert.equal(repo.length(), 30);
});

addKlinesFromRESTTest.run();