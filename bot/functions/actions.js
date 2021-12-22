import { logger } from './utils'

export const prepareOrder = (st, acbl, price, RSI, bottomBorder) => {
    if (RSI > st.HIGHEST_RSI) {
        logger.error(`Exiting, RSI is ${RSI}, which is above ${st.HIGHEST_RSI}`)
        return {'error': `Exiting, RSI is ${RSI}, which is above ${st.HIGHEST_RSI}`}
    }
    const fiat_pct = Number(st.FIAT_OR_QUOTE_PERCENT) / 100
    const buyingPrice = Number(price * bottomBorder).toFixed(`${st.info.quoteAssetPrecision}`)
    const quantityToBuy = ((acbl.FIAT * fiat_pct) / buyingPrice).toFixed(`${st.info.minQty}`)
    // Initialize order options
    const orderOptions = {
        symbol: `${st.MAIN_MARKET}`,
        side: 'BUY',
        type: 'LIMIT',
        timeInForce: 'GTC',
        timestamp: Date.now(),
        quantity: quantityToBuy,
        price: buyingPrice,
        newClientOrderId: Date.now()
    }
    if ( (quantityToBuy != 0) && (quantityToBuy * buyingPrice) >= Number(st.info.minOrder)) {
        return {...orderOptions}
    } else if ((quantityToBuy * buyingPrice) <= Number(st.info.minOrder)) {
        return {'error': `You cannot buy with ${acbl.FIAT}. It is less than the minimum ${Number(st.info.minOrder)} ${st.info.quoteAsset}`}
    } else {
        return {'error': 'There was an error placing BUY order.'}
    }
}
