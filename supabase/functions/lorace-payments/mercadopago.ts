export type MpPayment = { id:string|number; external_reference:string; collector_id:string|number; live_mode:boolean; status:string; currency_id:string; transaction_amount:number; transaction_amount_refunded?:number; date_last_updated:string };
export async function verifySignature(secret:string,signature:string|null,requestId:string|null,dataId:string,now=Date.now()):Promise<boolean>{
 if(!secret||!signature||!requestId||!/^\d{1,30}$/.test(dataId))return false;
 const parts=Object.fromEntries(signature.split(',').map(p=>p.trim().split('=')));
 if(!/^\d{10,13}$/.test(parts.ts??'')||!/^[0-9a-f]{64}$/.test(parts.v1))return false;
 const timestamp=Number(parts.ts)*(parts.ts.length<=10?1000:1);
 if(Math.abs(now-timestamp)>10*60*1000)return false;
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const mac=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`id:${dataId};request-id:${requestId};ts:${parts.ts};`));
 const expected=Array.from(new Uint8Array(mac),x=>x.toString(16).padStart(2,'0')).join('');
 let difference=expected.length^parts.v1.length;for(let i=0;i<expected.length;i++)difference|=expected.charCodeAt(i)^parts.v1.charCodeAt(i);
 return difference===0;
}
export function checkoutUrl(value:unknown):string{
 const url=new URL(String(value));
 if(url.protocol!=='https:'||!['www.mercadopago.com.br','mercadopago.com.br','sandbox.mercadopago.com.br'].includes(url.hostname)||!url.pathname.startsWith('/checkout/')||url.username||url.password)throw new Error('URL de pagamento inválida.');
 return url.href;
}
export function assertPayment(payment:MpPayment,collector:string,production:boolean){
 if((typeof payment.id==='number'&&!Number.isSafeInteger(payment.id))||(typeof payment.collector_id==='number'&&!Number.isSafeInteger(payment.collector_id))||String(payment.collector_id)!==collector||payment.live_mode!==production||!/^\d{1,30}$/.test(String(payment.id))||payment.currency_id!=='BRL'||!Number.isFinite(payment.transaction_amount)||payment.transaction_amount<=0)throw new Error('Pagamento não confere com esta conta e ambiente.');
}
