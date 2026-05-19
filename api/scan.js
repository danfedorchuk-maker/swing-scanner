const API_KEY=process.env.TWELVE_DATA_API_KEY;
const BASE='https://api.twelvedata.com';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fetchCandles(symbol,interval){
const url=`${BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=20&apikey=${API_KEY}`;
const res=await fetch(url);
const data=await res.json();
if(data.status==='error')throw new Error(data.message);
return data.values;
}
function calcATR(candles){
const trs=candles.slice(0,14).map((c,i)=>{const h=parseFloat(c.high),l=parseFloat(c.low),pc=i<candles.length-1?parseFloat(candles[i+1].close):parseFloat(c.close);return Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc));});
return trs.reduce((a,b)=>a+b,0)/trs.length;
}
function detectConsolidation(candles){
const atr=calcATR(candles);
for(let w=8;w>=2;w--){const s=candles.slice(0,w),rh=Math.max(...s.map(c=>parseFloat(c.high))),rl=Math.min(...s.map(c=>parseFloat(c.low))),range=rh-rl;if(range<atr*0.4)return{consolidating:true,candle_count:w,range_high:rh,range_low:rl,range,atr,tightness:1-(range/(atr*0.4))};}
return{consolidating:false,candle_count:0,range:0,atr:calcATR(candles),tightness:0};
}
function determineBias(candles,cons){
if(!cons.consolidating)return'none';
const prior=candles.slice(cons.candle_count,cons.candle_count+6);
if(prior.length<2)return'coil';
const pc=parseFloat(prior[0].close),po=parseFloat(prior[prior.length-1].open);
const ph=Math.max(...prior.map(c=>parseFloat(c.high))),pl=Math.min(...prior.map(c=>parseFloat(c.low)));
const mid=(cons.range_high+cons.range_low)/2,pm=(ph+pl)/2,up=pc>po;
return up&&mid>pm?'long':!up&&mid<pm?'short':up?'long':'short';
}
function nearSR(candles,cons){
if(!cons.consolidating)return false;
const mid=(cons.range_high+cons.range_low)/2,prior=candles.slice(cons.candle_count+2);
return prior.some(c=>Math.abs(parseFloat(c.high)-mid)<cons.atr*0.5||Math.abs(parseFloat(c.low)-mid)<cons.atr*0.5);
}
function pips(range,pair){return Math.round(range/(pair.includes('JPY')?0.01:0.0001));}
function trend(candles){const r=parseFloat(candles[0].close),o=parseFloat(candles[7].close);return r>o*1.001?'up':r<o*0.999?'down':'sideways';}
async function analyzePair(pair){
const[h4,h1]=await Promise.all([fetchCandles(pair,'4h'),fetchCandles(pair,'1h')]);
const h4c=detectConsolidation(h4),h1c=detectConsolidation(h1);
const pc=h4c.consolidating?h4c:h1c,pd=h4c.consolidating?h4:h1;
const bias=determineBias(pd,pc),sr=nearSR(h4,h4c);
const strength=pc.consolidating?Math.min(Math.round(pc.tightness*60+(sr?25:0)+(bias!=='coil'?15:0)),99):0;
return{pair,h4_candles:h4c.candle_count,h1_candles:h1c.candle_count,consolidating:pc.consolidating,bias:pc.consolidating?bias:'none',strength,near_sr:sr,range_pips:pips(pc.range||0,pair),h4_trend:trend(h4)};
}
module.exports=async function handler(req,res){
if(!API_KEY)return res.status(500).json({error:'TWELVE_DATA_API_KEY not set'});
const pair=req.query.pair;
if(!pair)return res.status(400).json({error:'pair required'});
try{
const result=await analyzePair(pair);
return res.status(200).json(result);
}catch(e){return res.status(500).json({error:e.message,pair});}
};
