const PAIRS=['EUR/USD','GBP/USD','USD/JPY','USD/CHF','AUD/USD','USD/CAD','NZD/USD','EUR/GBP','EUR/JPY','GBP/JPY','AUD/JPY','CAD/JPY','CHF/JPY','NZD/JPY','EUR/CHF','EUR/AUD','EUR/CAD','EUR/NZD','GBP/CHF','GBP/AUD','GBP/CAD','GBP/NZD','AUD/CAD','AUD/CHF','AUD/NZD','CAD/CHF','NZD/CAD','NZD/CHF'];
const API_KEY=process.env.TWELVE_DATA_API_KEY;
const BASE='https://api.twelvedata.com';
async function fetchCandles(symbol,interval){
const url=`${BASE}/time_series?symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=20&apikey=${API_KEY}`;
const res=await fetch(url);
const data=await res.json();
if(data.status==='error')throw new Error(data.message);
return data.values;
}
function calcATR(candles){
const trs=candles.slice(0,14).map((c,i)=>{
const h=parseFloat(c.high),l=parseFloat(c.low);
const pc=i<candles.length-1?parseFloat(candles[i+1].close):parseFloat(c.close);
return Math.max(h-l,Math.abs(h-pc),Math.abs(l-pc));
});
return trs.reduce((a,b)=>a+b,0)/trs.length;
}
function detectConsolidation(candles){
const atr=calcATR(candles);
for(let w=8;w>=2;w--){
const s=candles.slice(0,w);
const rh=Math.max(...s.map(c=>parseFloat(c.high)));
const rl=Math.min(...s.map(c=>parseFloat(c.low)));
const range=rh-rl;
if(range<atr*0.4){return{consolidating:true,candle_count:w,range_high:rh,range_low:rl,range,atr,tightness:1-(range/(atr*0.4))};}
}
return{consolidating:false,candle_count:0,range:0,atr,tightness:0};
}
function determineBias(candles,cons){
if(!cons.consolidating)return'none';
const prior=candles.slice(cons.candle_count,cons.candle_count+6);
if(prior.length<2)return'coil';
const pc=parseFloat(prior[0].close),po=parseFloat(prior[prior.length-1].open);
const ph=Math.max(...prior.map(c=>parseFloat(c.high)));
const pl=Math.min(...prior.map(c=>parseFloat(c.low)));
const mid=(cons.range_high+cons.range_low)/2;
const pm=(ph+pl)/2;
const up=pc>po;
if(up&&mid>pm)return'long';
if(!up&&mid<pm)return'short';
if(up&&mid<=pm)return'long';
if(!up&&mid>=pm)return'short';
return'coil';
}
function nearSR(candles,cons){
if(!cons.consolidating)return false;
const atr=cons.atr;
const mid=(cons.range_high+cons.range_low)/2;
const prior=candles.slice(cons.candle_count+2);
return prior.some(c=>Math.abs(parseFloat(c.high)-mid)<atr*0.5||Math.abs(parseFloat(c.low)-mid)<atr*0.5);
}
function pips(range,pair){return Math.round(range/(pair.includes('JPY')?0.01:0.0001));}
function trend(candles){
if(candles.length<8)return'unknown';
const r=parseFloat(candles[0].close),o=parseFloat(candles[7].close);
return r>o*1.001?'up':r<o*0.999?'down':'sideways';
}
async function analyzePair(pair){
const[h4,h1]=await Promise.all([fetchCandles(pair,'4h'),fetchCandles(pair,'1h')]);
const h4c=detectConsolidation(h4);
const h1c=detectConsolidation(h1);
const pc=h4c.consolidating?h4c:h1c;
const pd=h4c.consolidating?h4:h1;
const bias=determineBias(pd,pc);
const sr=nearSR(h4,h4c);
const strength=pc.consolidating?Math.min(Math.round(pc.tightness*60+(sr?25:0)+(bias!=='coil'?15:0)),99):0;
return{pair,h4_candles:h4c.candle_count,h1_candles:h1c.candle_count,consolidating:pc.consolidating,bias:pc.consolidating?bias:'none',strength,near_sr:sr,range_pips:pips(pc.range||0,pair),avg_volume:h4[0]?.volume?Math.round(parseFloat(h4[0].volume)):0,h4_trend:trend(h4)};
}
export default async function handler(req,res){
if(!API_KEY)return res.status(500).json({error:'TWELVE_DATA_API_KEY not set'});
try{
const results=[];
for(let i=0;i<PAIRS.length;i+=8){
const batch=PAIRS.slice(i,i+8);
const br=await Promise.allSettled(batch.map(p=>analyzePair(p)));
br.forEach((r,j)=>results.push(r.status==='fulfilled'?r.value:{pair:batch[j],h4_candles:0,h1_candles:0,consolidating:false,bias:'error',strength:0,near_sr:false,range_pips:0,avg_volume:0,h4_trend:'unknown'}));
if(i+8<PAIRS.length)await new Promise(r=>setTimeout(r,500));
}
const cons=results.filter(r=>r.consolidating);
const non=results.filter(r=>!r.consolidating&&r.bias!=='error');
return res.status(200).json({pairs:[...cons,...non],scanned_at:new Date().toISOString(),total:PAIRS.length});
}catch(e){return res.status(500).json({error:e.message});}
}
