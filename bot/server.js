const fs = require('fs')
const express = require('express')
const http = require('http');

const app = express()
const server = http.createServer(app);
const io = require('socket.io')(server);

const Binance = require('node-binance-api');

import { trade } from './index'
import { clearInterval } from 'timers'
import { logger, profitTracker, addKlineFromWS, addKlinesFromREST, CandlesRepo, TickerPrice, Account } from './functions/utils'
import { exchangeInfo } from './functions/info'

io.on('connection', (socket) => {
    logger.info('a user connected');
});

app.set('view engine', 'pug');
app.set('views', './views');
app.use(express.urlencoded({ extended: true }));

let obj = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
let info = {
    minOrder: 0,
    minQty: 0,
    baseAsset: '',
    quoteAsset: '',
    quoteAssetPrecision: 0
}

const port = obj.PORT

app.get('/', (req, res) => {
    res.render('form', { data: obj });
});

app.post('/start', (req, res) => {
    let { pin, action } = req.body
    logger.info(action)
    if (pin == obj.PIN && action == 'START') {
        obj.STATE = 'ON'
        fs.writeFileSync('settings.json', JSON.stringify(obj, null, 2));
        clearInterval(draft)
        draft = setInterval(() => {
            if (obj.STATE == 'ON') {
                trade(obj, io)
            } else {
                return
            }
        }, obj.INTERVAL);
        res.redirect('/');
    } else {
        res.send("gHOST!");
    }
})

app.post('/stop', (req, res) => {
    let { pin, action } = req.body

    if (pin == obj.PIN && action == 'STOP') {
        obj.STATE = 'OFF'
        fs.writeFileSync('settings.json', JSON.stringify(obj, null, 2));
        logger.info(action)
        clearInterval(draft)
        res.redirect('/');
    } else {
        res.send("gHOST!");
    }
})

app.post('/', (req, res) => {
    let { pin,
        interval_value,
        market,
        room,
        asset_pct,
        fiat_or_quote_pct,
        after,
        instance,
        divider
    } = req.body

    if (pin == obj.PIN) {

        obj.INTERVAL = interval_value
        obj.MAIN_MARKET = market
        obj.CANCEL_AFTER = after
        obj.WIGGLE_ROOM = room
        obj.ASSET_PERCENT = asset_pct
        obj.FIAT_OR_QUOTE_PERCENT = fiat_or_quote_pct
        obj.INSTANCE_NAME = instance
        obj.BUYING_PRICE_DIVIDER = divider

        fs.writeFileSync('settings.json', JSON.stringify(obj, null, 2));

        obj = JSON.parse(fs.readFileSync('settings.json', 'utf8'));
        ; (async () => {
            info = { ...await exchangeInfo(obj) }
            obj.info = info
               if (obj.info.baseAsset == "") {
                  logger.error(`No information retreived. Probably the trading pair does not exist`)
                  process.exit()
               }
            clearInterval(draft)
            draft = setInterval(() => {
                if (obj.STATE == 'ON') {
                    trade(obj, io)
                } else {
                    return
                }
            }, obj.INTERVAL);
        })();

        res.redirect('/');
    } else {
        res.send("gHOST!");
    }

});

export const binance = Binance().options({
    APIKEY: obj.API_KEY,
    APISECRET: obj.API_SECRET,
    test: obj.TESTING,
    useServerTime: true,
    verbose: true,
});

//create a storage for the candles
export const kRepo = new CandlesRepo(30);

const addKlineWS = addKlineFromWS(kRepo);
export const addKlineRest = addKlinesFromREST(kRepo);

//create mark price stream
export const tickerRepo = new TickerPrice();

//create userData stream
export const accountRepo = new Account();



function main() {

    let draft
    ; (async () => {
        info = { ...await exchangeInfo(obj) }
        obj.info = info
           if (obj.info.baseAsset == "") {
              logger.error(`No information retreived. Probably the trading pair does not exist`)
              process.exit()
           }

        draft = setInterval(() => {
            if (obj.STATE == 'ON') {
                trade(obj, io)
            } else {
                return
            }
        }, obj.INTERVAL);
    })();

    // initialize profit tracker
    ; (async () => {
        await profitTracker(io, obj)
    })();

    //call rest server once
    (async () => {
        let timeout = undefined;
        let count = 0;
        const loopFetch = async () => {
            console.info('fetching new candles')
            try {
                const resp = await binance.futuresCandles(obj.MAIN_MARKET, '1m', {limit: 30});
                if(resp.hasOwnProperty('msg')){
                    throw resp.msg;
                }
                await addKlineRest(resp);
                timeout && clearInterval(timeout);
                console.info('fetching candles complete');
            } catch(e){
                console.error(`error fetching candles, the count is ${count}`, JSON.stringify(e));
                if (count > 3) {
                    clearInterval(timeout);
                    console.error(`Unable to fetch candles through REST timeout `, timeout);
                }
                else {
                    count++;  
                } 
            }
        }
        timeout = setInterval(() => {
            (async () => await loopFetch())();
        }, 30000);
    })();

    //start kline server
    binance.futuresSubscribe( `${obj.MAIN_MARKET.toLowerCase()}@kline_1m`, addKlineWS);

    //start mark price stream
    binance.futuresAggTradeStream( obj.MAIN_MARKET,  tickerRepo.updatePrice);

    //start userData stream
    binance.websockets.userFutureData(
        accountRepo.ws_margin_call, 
        accountRepo.ws_account_update, 
        accountRepo.ws_order_update, 
        accountRepo.ws_account_config_update);


    server.listen(port, '0.0.0.0', () => {
        logger.info(`Binance bot listening at http://localhost:${port}`)
    });
  }

if (require.main === module) {
    main();
}