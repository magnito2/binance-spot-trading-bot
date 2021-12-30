import { sendNotification, getRSI, sendErrors, logger } from './functions/utils'
import {
    prepareOrder
} from './functions/actions';

import { binance, tickerRepo } from './server';


let openOrders = []
let latestOrder = {
    side: 'BUY'
}

let acbl = {
    FIAT: 0,
    POSITION: undefined
}

// The loop is set to poll the APIs in X milliseconds. @TODO : Removing the polling
export const trade = async (settings, socket) => {
    // Calculate the highest and lowest percentage multipliers according to the set WIGGLE_ROOM
    const width = Number(settings.WIGGLE_ROOM / 100)
    const divider = Number(settings.BUYING_PRICE_DIVIDER)
    const fullMultiplier = (settings.WIGGLE_ROOM / 100) + 1
    let bottomBorder = 1 - (width / divider)

    let cancelAfter = Number(settings.CANCEL_AFTER)

    const RSI = await getRSI(settings)

        //Check and set account balances
        ; (async () => {
            //const { positions, assets } = await accountBalances(settings)
            const {positions, assets } = await binance.futuresAccount()

            if (positions) {
                for (let i in positions) {
                    if (positions[i].symbol == `${settings.MAIN_MARKET}`) {
                        acbl.POSITION = positions[i]
                    }
                }
            }
            else {
                console.log(`We have no open position`)
                acbl.POSITION = undefined; //reset
            }
            if(assets) {
    
                //console.log(`Account assets are ${JSON.stringify(assets)}`)
                for (let i in assets) {
                    if (assets[i].asset == `${settings.info.quoteAsset}`) {
                        acbl.FIAT = assets[i].availableBalance
                    }
                }
            }
        })();

    // Get the current price and also the latest two candle sticks
    //const price = await binance.futuresPrices({'symbol': settings.MAIN_MARKET});
    const price = Number(tickerRepo.getTickerPrice()).toFixed(`${settings.info.quoteAssetPrecision}`)
    logger.info(`Ticker: ${price}`);
    
    try {
        // Check for open orders and if it is a BUY order and has not been filled within X minutes, cancel it
        // so that you can place another BUY order
        openOrders = await binance.futuresOpenOrders(settings.MAIN_MARKET);

        //console.log(`Current open orders ${JSON.stringify(openOrders)}`)

        const currentOrder = openOrders.length > 0 ? openOrders[0] : undefined;
        if (currentOrder){
            if(
                ((Date.now() - Number(currentOrder.time)) / 1000) > cancelAfter
                && !currentOrder.reduceOnly
                )
            {
                logger.warn(`Doopsy, time for order ${currentOrder.orderId} done, Cancelling...`)
                console.log(await binance.futuresCancel(settings.MAIN_MARKET, {orderId: currentOrder.orderId}))
            }
        }
    } catch (error) {
        logger.error(error)
    }

    // Check if there is no open order, get the latest order and see if it was filed or cancelled and whether it is a 
    // buy order or a sell order.
    if (openOrders.length < 1) {

        // Check if there are existing orders, if any, then pick the top as the current order.
        const allOrders = await binance.futuresAllOrders( settings.MAIN_MARKET )

        // Throw error is one occurs
        if (allOrders.msg) {
            logger.error(allOrders.msg)
        }
        if (allOrders.length > 0) {
            latestOrder = allOrders[allOrders.length -1];
            //console.log(`Length of all orders are ${allOrders.length}\n Latest order is ${JSON.stringify(latestOrder)}\nLatest order is ${JSON.stringify(allOrders[allOrders.length - 1])}`);

            if ((latestOrder.side == 'SELL' && latestOrder.status == 'FILLED')
                || (latestOrder.status == 'CANCELED' && latestOrder.side == 'BUY')) {
                logger.info(`Placing normal BUY..`)
                logger.info(`Trade params are \n 1. PAIR ${settings.MAIN_MARKET} \t 2. Qty ${acbl.FIAT} \t 3. Price ${price}`)

                const orderParams = prepareOrder(settings, acbl, price, RSI, bottomBorder);
                if(orderParams.error){
                    logger.error(orderParams.error);
                    return
                } else {
                    latestOrder = await binance.futuresBuy( settings.MAIN_MARKET, orderParams.quantity, orderParams.price );
                    console.log(latestOrder)
                    logger.info(`New order placed, ID: ${latestOrder.orderId}, Qty: ${latestOrder.origQty}@${latestOrder.price} | ${latestOrder.side}`)
                    return
                }
            }

            // Reduce any current open position
            if (+acbl.POSITION.positionAmt ) {
                logger.info(`Current open position \n
                    AMOUNT: ${acbl.POSITION.positionAmt}, ENTRY: ${acbl.POSITION.entryPrice}`);
                
                const executionPrice = (acbl.POSITION.entryPrice * fullMultiplier) < price ? price : +acbl.POSITION.entryPrice * fullMultiplier;
                console.log(`Trade params are \n 1. PAIR ${settings.MAIN_MARKET} \t 2. Qty ${latestOrder.executedQty} \t 3. Price ${executionPrice}`)
                //latestOrder = await placeSell(acbl, latestOrder, fullMultiplier, current_price, settings)
                
                console.info(
                    await binance.futuresSell(
                        settings.MAIN_MARKET, 
                        (+acbl.POSITION.positionAmt).toFixed(settings.info.minQty), 
                        (+executionPrice).toFixed(`${settings.info.quoteAssetPrecision}`), 
                        {reduceOnly: true}
                        )
                    )
                return
            }

        } else {
            sendNotification(`There is no open order currently. Deciding which side to start with...`, settings)

            if (acbl.FIAT > Number(settings.info.minOrder)) {
                logger.info(`Placing initial BUY..`)
                //latestOrder = await placeInitialBuy(acbl, RSI, bottomBorder, price, settings)
                const orderParams = prepareOrder(settings, acbl, price, RSI, bottomBorder);
                if(orderParams.error){
                    logger.error(orderParams.error);
                    return
                } else {
                    latestOrder = await binance.futuresBuy( settings.MAIN_MARKET, orderParams.quantity, orderParams.price );
                    logger.info(`New order placed, ID: ${latestOrder.orderId}, Qty: ${latestOrder.quantity}@${latestOrder.price} | ${latestOrder.side}`)
                    return
                }

                return

            } else if (+acbl.POSITION.positionAmt) {
                // Initialize order options
                logger.info(`Closing Initial Position..`)
                const executionPrice = (acbl.POSITION.entryPrice * fullMultiplier) < price ? price : +acbl.POSITION.entryPrice * fullMultiplier;
                console.log(`Trade params are \n 1. PAIR ${settings.MAIN_MARKET} \t 2. Qty ${latestOrder.executedQty} \t 3. Price ${executionPrice}`)
                
                latestOrder = await binance.futuresSell(
                        settings.MAIN_MARKET, 
                        (+acbl.POSITION.positionAmt).toFixed(settings.info.minQty), 
                        (+executionPrice).toFixed(`${settings.info.quoteAssetPrecision}`), 
                        {reduceOnly: true}
                        );
                logger.info(`New order placed, ID: ${latestOrder.orderId}, Qty: ${latestOrder.quantity}@${latestOrder.price} | ${latestOrder.side}`)      
                return

            } else {
                logger.error(`Insufficient funds..`)
                sendErrors(`Please add money to your account. You currently have only: $${acbl.FIAT} and ${acbl.MAIN_ASSET}${settings.MAIN_ASSET}, which is insufficient.`, settings)
            }

        }

    } else {

        // If there is still an open order, just set that open order as the latest order
        latestOrder = openOrders[0]
    }

    // Log information in the console about the pending order
    try {
        if (latestOrder) {
            socket.emit('pending', latestOrder);
            socket.emit('ticker', price);
            logger.info(`Latest Order: | ${latestOrder.origQty}@${latestOrder.price} | ${latestOrder.side} | ${latestOrder.status}`)
        }
    } catch (error) {
        logger.error("There was an error..", error)
    }

    console.log('************************************************************\n');

};
