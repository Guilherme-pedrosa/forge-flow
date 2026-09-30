import { chromium, expect } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { zipSync, strToU8 } from "fflate";
const output = "artifacts/3d-workflows";
await mkdir(output, { recursive: true });
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5175";
const mesh =
  '<mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="20" y="0" z="0"/><vertex x="0" y="20" z="0"/><vertex x="0" y="0" z="20"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/><triangle v1="0" v2="1" v3="3"/><triangle v1="0" v2="2" v3="3"/><triangle v1="1" v2="2" v3="3"/></triangles></mesh>';
const project = zipSync({
  "3D/3dmodel.model": strToU8(
    `<model><resources>${[1, 2, 3].map((id) => `<object id="${id}" name="${["Body", "Stem", "Leaf"][id - 1]}">${mesh}</object>`).join("")}</resources><build>${[1, 2, 3].map((id) => `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${id * 35} 0 0"/>`).join("")}</build></model>`,
  ),
  "Metadata/model_settings.config": strToU8(
    `<config>${[1, 2, 3].map((id) => `<object id="${id}"><metadata key="name" value="${["Body", "Stem", "Leaf"][id - 1]}"/></object><plate><metadata key="plater_id" value="${id}"/><model_instance><metadata key="object_id" value="${id}"/></model_instance></plate>`).join("")}</config>`,
  ),
});
const browser = await chromium.launch({
  headless: true,
  channel: "msedge",
  args: ["--enable-unsafe-swiftshader"],
});
try {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport,
      acceptDownloads: true,
    });
    const page = await context.newPage(),
      errors = [],
      writes = [];
    const products = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Maçã termoformada com caule e folha para presente personalizado",
        sku: "MACA-VERMELHA-001",
        sale_price: 19.9,
        is_active: true,
        category: "printed_part",
        extras: [],
        prints_per_plate: 1,
        num_colors: 1,
      },
    ];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/src/contexts/AuthContext.tsx")
        return route.fulfill({
          contentType: "application/javascript",
          body: `export const useAuth=()=>({profile:{id:'user',user_id:'user',tenant_id:'tenant'},user:{id:'user'},loading:false,signOut:async()=>{}});export const AuthProvider=({children})=>children;`,
        });
      if (url.pathname.includes("/rest/v1/")) {
        const name = url.pathname.split("/").pop();
        let data = [];
        if (name === "products") data = products;
        if (name === "tenants") data = { name: "Teste", settings: {} };
        if (name === "save_product_with_photos") {
          const payload = route.request().postDataJSON();
          writes.push({ name, payload });
          const id = "22222222-2222-4222-8222-222222222222";
          products.push({ ...payload.p_product, id, is_active: true });
          data = id;
        }
        if (name === "consignment_locations")
          data = [
            {
              id: "point",
              name: "Loja parceira",
              commission_percent: 20,
              customer_id: "customer",
              is_active: true,
            },
          ];
        if (name === "consignment_items")
          data = [
            {
              id: "point-stock",
              location_id: "point",
              product_id: products[0].id,
              current_qty: 10,
              sale_price: 20,
              products: { name: products[0].name, sale_price: 20 },
            },
          ];
        if (name === "reconcile_consignment") {
          writes.push({ name, payload: route.request().postDataJSON() });
          data = "result";
        }
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(data),
        });
      }
      if (url.hostname !== "127.0.0.1")
        return route.fulfill({ contentType: "application/json", body: "{}" });
      return route.continue();
    });
    await page.goto(base + "/comercial/precificacao");
    await page
      .getByLabel("Nome do produto", { exact: true })
      .fill("Peça calculada");
    await page.getByLabel("Unidades prontas no lote").fill("10");
    await page.getByLabel("Gramas no lote").fill("100");
    await page.getByLabel("Custo / kg (R$)").fill("100");
    await page.getByLabel("Preço alvo por unidade (R$)").fill("5");
    await page.getByLabel("Margem desejada sobre a venda (%)").fill("100");
    await expect(page.getByRole("alert")).toContainText("margem");
    await page.getByLabel("Margem desejada sobre a venda (%)").fill("30");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `${output}/pricing-${viewport.width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Cadastrar produto e orçar", exact: true })
      .click();
    const productDialog = page.getByRole("dialog", { name: "Novo Produto" });
    await expect(productDialog).toBeVisible();
    await productDialog
      .getByRole("button", { name: "Criar", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Novo orçamento" }),
    ).toBeVisible();
    expect(writes[0].payload.p_product.cost_estimate).toBe(1);
    expect(writes[0].payload.p_product.sale_price).toBe(5);
    await expect(page.locator('input[value="10"]')).toBeVisible();
    await expect(page.locator('input[value="5"]')).toBeVisible();
    await page.screenshot({ path: `${output}/quote-${viewport.width}.png` });
    await page.goto(base + "/comercial/etiquetas");
    await page.getByRole("combobox", { name: "Produto para etiqueta" }).click();
    await page.getByRole("option", { name: /Maçã termoformada/ }).click();
    await page.getByLabel("Quantidade de etiquetas").fill("19");
    await page.getByLabel("QR da etiqueta").selectOption("pix");
    await page
      .getByLabel("Chave Pix", { exact: true })
      .fill("123e4567-e12b-12d1-a456-426655440000");
    await page
      .getByLabel("Nome do recebedor (até 25 caracteres)")
      .fill("Elevare 3D");
    await page.getByLabel("Cidade (até 15 caracteres)").fill("Anápolis");
    await expect(
      page.getByRole("img", { name: "Prévia do QR da etiqueta" }),
    ).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: /Baixar PDF/ }).click();
    const pdf = await download;
    await pdf.saveAs(`${output}/labels-${viewport.width}.pdf`);
    expect(
      (await readFile(`${output}/labels-${viewport.width}.pdf`))
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");
    await page.screenshot({
      path: `${output}/labels-${viewport.width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.goto(base + "/comercial/produtos");
    await page
      .getByRole("button", { name: "Novo Produto", exact: true })
      .click();
    await page.getByLabel("Nome *", { exact: true }).fill("Composto local");
    await page.getByRole("tab", { name: "Composição / produção" }).click();
    await page
      .getByLabel("Abrir projeto 3MF ou peça STL")
      .setInputFiles({
        name: "composite.3mf",
        mimeType: "application/octet-stream",
        buffer: Buffer.from(project),
      });
    await page.getByRole("button", { name: "Folha · placa 3 · 1 un." }).click();
    await expect(page.locator("canvas")).toBeVisible();
    await page.screenshot({ path: `${output}/model-${viewport.width}.png` });
    await page
      .getByRole("button", { name: "Usar estas peças no produto" })
      .click();
    await page
      .getByRole("button", { name: "Esta composição forma 1 produto" })
      .click();
    await page.getByRole("button", { name: "Criar", exact: true }).click();
    await expect
      .poll(
        () =>
          writes.filter((w) => w.name === "save_product_with_photos").length,
      )
      .toBe(2);
    const saved = writes.filter((w) => w.name === "save_product_with_photos")[1]
      .payload.p_product;
    expect(saved.file_composition.plates.map((p) => p.parts[0].name)).toEqual([
      "Corpo",
      "Caule",
      "Folha",
    ]);
    await page.goto(base + "/comercial/consignado");
    await page.getByText("Loja parceira", { exact: true }).click();
    await page
      .getByRole("button", {
        name: "Conferir vendas e devoluções",
        exact: true,
      })
      .click();
    const reconciliation = page.getByRole("dialog", {
      name: "Conferir vendas e devoluções",
    });
    await reconciliation.getByLabel("Vendidas", { exact: true }).fill("3");
    await reconciliation.getByLabel("Recolher ao estoque").fill("2");
    await expect(reconciliation).toContainText("48,00");
    await page.screenshot({
      path: `${output}/reconciliation-${viewport.width}.png`,
    });
    await reconciliation
      .getByRole("button", { name: "Confirmar conferência" })
      .click();
    await expect
      .poll(
        () => writes.filter((w) => w.name === "reconcile_consignment").length,
      )
      .toBe(1);
    expect(
      writes.find((w) => w.name === "reconcile_consignment").payload.p_items[0],
    ).toMatchObject({ sold: 3, returned: 2, expected_qty: 10 });
    expect(errors).toEqual([]);
    console.log(
      `PASS ${viewport.width}: calculator → product → quote, real PDF, 3MF mesh/composition, reconciliation payload`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
