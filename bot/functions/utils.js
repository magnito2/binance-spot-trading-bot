const fetch = require('node-fetch');
const winston = require('winston');
const fs = require('fs');
const cron = require('node-cron');

import { avgPrice30, avgPrice, getAllOrders } from './info';
import { kRepo } from '../server';

const logDir = 'logs';
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir);
}

export const logger = winston.createLogger({
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({
            level: 'error',
            filename: `${logDir}/logs.log`,
        })
    ]
});

export const sendNotification = (message, st) => {
    sendDiscord(`${message}`, st)
    sendTelegram(`${message}`, st)
}
// Send discord messages, no fancy formatting, just the content of the message.
export const sendDiscord = (message, st) => {
    fetch(`${st.DISCORD}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            content: `${st.INSTANCE_NAME}: ${message}`
        })
    }).then(data => {
        // console.log(data)
    }).catch(e => {
        logger.error(e)
        // console.log(e)
    })
}
// Send telegram messages, no fancy formatting, just the content of the message.
const sendTelegram = (message, st) => {
    fetch(`https://api.telegram.org/bot${st.TELEGRAM_TOKEN}/sendMessage?chat_id=${st.TELEGRAM_CHATID}&text=${st.INSTANCE_NAME}: ${message}`, {
        method: 'POST',

    }).then(data => {
        // console.log(data)
    }).catch(e => {
        logger.error(e)
        // console.log(e)
    })
}

export const sendErrors = (message, st) => {
    fetch(`${st.DISCORD_ERRORS}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            content: `${st.INSTANCE_NAME}: ${message}`
        })
    }).then(data => {
        // console.log(data)
    }).catch(e => {
        logger.error(e)
        // console.log(e)
    })
}

export const getRSI = async function (st) {
    let upMoves = 0
    let downMoves = 0

    kRepo.sticks.forEach((kline, index) => {
        if (kline.open < kline.close) {
            upMoves += 1
        }
        if (kline.open > kline.close) {
            downMoves += 1
        }
    });
    const avgU = (upMoves / 30).toFixed(8)
    const avgD = (downMoves / 30).toFixed(8)
    const RS = avgU / avgD
    const RSI = 100 - (100 / (1 + RS))
    return RSI
}

// profit checking function
const check = async function (io, obj) {
    try {
        const orders = await getAllOrders({
            symbol: `${obj.MAIN_MARKET}`,
            timestamp: Date.now(),
            startTime: Date.now() - (3600 * 1000 * 24)
        }, obj)

        let quantities = []
        orders.forEach(element => {
            if (element.status == 'FILLED' && element.side == 'SELL') {
                quantities.push({
                    y: Number(element.origQty),
                    x: element.time
                })
            }
        });

        io.emit('quantities', quantities);
    } catch (error) {
        logger.error(error)
    }

}

// check profit utility, check initially, and then schedule a check every one minute
export const profitTracker = async (io, obj) => {

    // initial check
    await check(io, obj)

    cron.schedule('* * * * *', async () => {

        // subsequent checks by the minute
        await check(io, obj)
    });
}

//Make a TickerPrice object to alway have the latest price using websocket
export function TickerPrice(window=10){
    let latestPrice = 0;
    let updateTime = 0;
    const updateWindow = +window
    this.isUpdated = () => Date.now() - updateTime < updateWindow * 1000; //ensure last update is within bounds

    this.updatePrice = (obj) => {
        latestPrice = obj.price;
        updateTime = obj.timestamp;
    }

    this.getTickerPrice = () => {
        return latestPrice;
    }
}

//Make a klines object that will store set number klines
export function Kline(open, high, low, close, vol, openTime, closeTime){
    this.open = Number(open);
    this.high = Number(high);
    this.low = Number(low);
    this.close = Number(close);
    this.vol = Number(vol);
    this.openTime = openTime;
    this.closeTime = closeTime;
}

export function CandlesRepo (size, klines = []) {
    this.size = size;
    this.sticks = klines;
}

CandlesRepo.prototype.isEmpty = function () {
    return this.sticks.length == 0;
}

CandlesRepo.prototype.add = function (kline) {
    if(this.sticks.length < this.size){
        this.sticks.push(kline);
        this.sticks.sort((a,b) => {
            if(a.openTime < b.openTime) return -1;
            if(a.openTime > b.openTime) return 1;
            return 0;
        });
    }
    else if(this.last().openTime < kline.openTime){
        this.sticks.push(kline);
        this.sticks.shift();
    } else {
        console.log(`Cannot add an older kline than the latest, latest ${this.last().openTime}, adding ${kline.openTime}`)
    }
}

CandlesRepo.prototype.peek = function (index = 0) {
    return !this.isEmpty() && this.sticks.length > index ? this.sticks[index]  : undefined;
}

CandlesRepo.prototype.last = function () {
    return !this.isEmpty() ? this.sticks[this.sticks.length - 1]  : undefined;
}

CandlesRepo.prototype.length = function () {
    return this.sticks.length;
}

CandlesRepo.prototype[Symbol.iterator] = function() {
    let index = 0;
    return {
        next: () => {
            return index < this.sticks.length ? {
                value: this.sticks[index++],
                done: false
            } : {
                done: true
            }
        }
    }
}

export const addKlineFromWS = (repo) => (obj) => {
    //only add the final closing kline for the timeframe
    if(obj.k.x){
        const kline = new Kline(
            obj.k.o, //open price
            obj.k.h, //high price
            obj.k.l, //low price
            obj.k.c, //close price
            obj.k.v, //base volume
            obj.k.t, //start time
            obj.k.T //close time
        );
        repo.add(kline);
    
        console.log(`kline has been added, close ${kline.close}, new length ${repo.length()}`);
    }
}

export const addKlinesFromREST = (repo) => async (st) => {

    const resp = await avgPrice30(`${st.MAIN_MARKET}`, st)

    if(resp.hasOwnProperty('msg')){
        console.error(resp.msg);
        return;
    }

    const arr = resp;

    if(!Array.isArray(arr)){
        console.error(`${arr} expected an array`);
        return
    }

    arr.forEach((kline) =>{
        const candle = new Kline(
            kline[1], //open price
            kline[2], //high price
            kline[3], //low price
            kline[4], //close price
            kline[5], //base volume
            kline[0], //start time
            kline[6] //close time
        );
        repo.add(candle);
    });
}