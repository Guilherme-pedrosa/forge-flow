import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { marketplaceBindingKey, marketplaceImportExample, parseMarketplaceImport } from "./marketplace-orders";
import { normalizeMercadoLivreOrder } from "../../supabase/functions/marketplace-sync/mercado-livre";

const example = () => JSON.parse(marketplaceImportExample)[0];
const parse = (value: unknown) => parseMarketplaceImport(JSON.stringify(value), "json");
describe("importação multicanal conferida", () => {
  it("preserva IDs grandes como texto e valores em centavos", () => {
    const order = example(); order.external_order_id = "90071992547409931234"; order.items[0].unit_price = "49.90";
    expect(parse(order)[0]).toMatchObject({ external_order_id: "90071992547409931234", items: [{ unit_price: 49.9 }] });
    order.external_order_id = 9007199254740993; expect(() => parse(order)).toThrow();
  });
  it("agrupa CSV com aspas, vírgulas e quebras sem confundir itens e pedidos", () => {
    const csv = 'external_order_id,external_status,normalized_state,external_updated_at,external_line_id,external_sku,description,quantity,unit_price\n0001,paid,paid,2026-10-10T12:00:00-03:00,1,A,"Peça, azul\ncom base",2,19.90\n0001,paid,paid,2026-10-10T12:00:00-03:00,2,B,"Texto ""citado""",1,2.00';
    const orders = parseMarketplaceImport(csv,"csv"); expect(orders).toHaveLength(1); expect(orders[0].items).toHaveLength(2);
    expect(orders[0].external_order_id).toBe("0001"); expect(orders[0].items[0].description).toBe("Peça, azul\ncom base");
  });
  it("rejeita estados divergentes e aspas quebradas no CSV", () => {
    const header = 'external_order_id;external_status;normalized_state;external_updated_at;external_line_id;external_sku;description;quantity;unit_price\n';
    expect(() => parseMarketplaceImport(header + 'A;paid;paid;2026-10-10T12:00:00Z;1;SKU;A;1;1\nA;cancelled;cancelled;2026-10-10T12:00:00Z;2;SKU;B;1;1',"csv")).toThrow("divergentes");
    expect(() => parseMarketplaceImport(header + 'A;paid;paid;2026-10-10T12:00:00Z;1;SKU;"a;1;1',"csv")).toThrow("aspas");
  });
  it.each(["2026-10-10T12:00:00", "2026-02-30T12:00:00Z", "amanhã"])("rejeita data inválida %s", date => {
    const order = example(); order.shipping_deadline_at = date; expect(() => parse(order)).toThrow();
  });
  it.each([-1, 1.999, "1,90", Infinity])("rejeita moeda inválida %s", price => { const order=example();order.items[0].unit_price=price;expect(()=>parse(order)).toThrow(); });
  it("rejeita linhas duplicadas, pedidos duplicados, quantidade fracionária e desconto excessivo", () => {
    const duplicate=example();duplicate.items.push(duplicate.items[0]);expect(()=>parse(duplicate)).toThrow("repetido");
    expect(()=>parse([example(),example()])).toThrow("repetido");
    const qty=example();qty.items[0].quantity=1.5;expect(()=>parse(qty)).toThrow();
    const discount=example();discount.discount_amount=50;expect(()=>parse(discount)).toThrow("Desconto");
  });
  it("não colide o vínculo de duas variações com separadores nos identificadores", () => {
    expect(marketplaceBindingKey({external_item_id:"a|b",external_variant_id:"c",external_sku:"d"})).not.toBe(marketplaceBindingKey({external_item_id:"a",external_variant_id:"b|c",external_sku:"d"}));
  });
});

const ml = () => ({ id:"200000000000001",seller:{id:123},currency_id:"BRL",status:"paid",date_last_updated:"2026-10-10T12:00:00Z",pack_id:"888",shipping:{id:456},shipping_cost:0,total_amount:99.8,order_items:[{quantity:2,unit_price:49.9,item:{id:"MLB123",variation_id:999,seller_sku:"AZUL",title:"Suporte"}}],tags:[] });
describe("tradução dos recursos oficiais Mercado Livre", () => {
  it("preserva prazo oficial, pack, anúncio e variação sem inventar taxa/repasse", () => {
    expect(normalizeMercadoLivreOrder(ml(),{expected_date:"2026-10-11T18:00:00-03:00"},"123")).toMatchObject({normalized_state:"paid",external_pack_id:"888",shipping_deadline_at:"2026-10-11T18:00:00-03:00",seller_fees:null,reported_total:99.8,items:[{external_item_id:"MLB123",external_variant_id:"999",external_sku:"AZUL"}]});
  });
  it("ausência do SLA não vira prazo de três dias", () => expect(normalizeMercadoLivreOrder(ml(),{},"123").shipping_deadline_at).toBeNull());
  it("bloqueia outro vendedor, fraude, devolução parcial e pagamento insuficiente", () => {
    expect(()=>normalizeMercadoLivreOrder(ml(),{},"456")).toThrow("outro vendedor");
    const fraud={...ml(),tags:["fraud_risk_detected"]};expect(normalizeMercadoLivreOrder(fraud,{},"123").normalized_state).toBe("unknown");
    expect(normalizeMercadoLivreOrder({...ml(),status:"partially_refunded"},{},"123").normalized_state).toBe("unknown");
    expect(normalizeMercadoLivreOrder({...ml(),status:"partially_paid"},{},"123").normalized_state).toBe("awaiting_payment");
  });
  it("pedido enviado/entregue não volta para impressão e cancelamento prevalece", () => {
    expect(normalizeMercadoLivreOrder({...ml(),tags:["shipped"]},{},"123").normalized_state).toBe("shipped");
    expect(normalizeMercadoLivreOrder({...ml(),tags:["delivered"]},{},"123").normalized_state).toBe("delivered");
    expect(normalizeMercadoLivreOrder({...ml(),status:"cancelled",tags:["delivered"]},{},"123").normalized_state).toBe("cancelled");
  });
});
