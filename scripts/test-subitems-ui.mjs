import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const output = "artifacts/subitems";
await mkdir(output, { recursive: true });
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5175";
const id = (n) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: 900 },
      }),
      page = await context.newPage(),
      writes = [],
      errors = [];
    const technical = {
      source: "manual",
      revision: null,
      materials: [
        {
          item_id: null,
          material: "PLA",
          color: "Vermelho",
          grams: 5,
          cost_per_kg: 80,
        },
      ],
      grams: 5,
      print_seconds: 120,
      finishing_seconds: 0,
      machine_hour_cost: 6,
      labor_hour_cost: 0,
      extra_cost: 0,
      pieces_per_plate: 10,
      estimated_cost: 0.6,
    };
    const parts = ["Metade da maçã", "Caule", "Folha"].map((name, i) => ({
      id: id(10 + i),
      component_product_id: id(20 + i),
      stock_item_id: id(30 + i),
      label: name,
      name,
      sku: `MACA-${i}`,
      quantity_per_product: i === 0 ? 2 : 1,
      quantity_per_plate: i === 0 ? 10 : 5,
      plate_id: id(40),
      plate_index: 1,
      plate_label: "Placa mista",
      balance: [20, 10, 6][i],
      available: [20, 10, 6][i],
      reserved: 0,
      pending: 0,
      required: i === 0 ? 20 : 10,
      missing: i === 2 ? 4 : 0,
      to_print: i === 2 ? 4 : 0,
      prepared: true,
      technical,
    }));
    const products = [
      {
        id: id(1),
        name: "Maçã termoformada",
        sku: "MACA",
        sale_price: 20,
        is_active: true,
        assembly_enabled: true,
        component_inventory_mode: true,
        category: "printed_part",
        extras: [],
        prints_per_plate: 1,
        num_colors: 1,
      },
      ...parts.map((p) => ({
        id: p.component_product_id,
        name: p.name,
        sku: p.sku,
        is_component: true,
        stock_item_id: p.stock_item_id,
        stock: {
          id: p.stock_item_id,
          current_stock: p.balance,
          avg_cost: 1,
          unit: "un",
        },
        sale_price: null,
        is_active: true,
        assembly_enabled: false,
        category: "printed_part",
        extras: [],
        prints_per_plate: 1,
        num_colors: 1,
      })),
    ];
    const status = {
      product_id: id(1),
      name: products[0].name,
      enabled: true,
      individual_stock: true,
      required: 10,
      assembled: 0,
      ready_to_assemble: 6,
      finished_stock: 0,
      components: parts,
      issues: [],
    };
    const job = {
      id: id(50),
      code: "OI-TESTE",
      name: "Placa mista",
      status: "quality_check",
      planned_quantity: 20,
      produced_quantity: 20,
      component_stock_key: "key",
      production_snapshot: {
        individual_stock: true,
        physical_outputs: parts.map((p) => ({
          component_product_id: p.component_product_id,
          name: p.name,
          quantity: p.quantity_per_plate,
        })),
      },
    };
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/src/contexts/AuthContext.tsx")
        return route.fulfill({
          contentType: "application/javascript",
          body: `export const useAuth=()=>({profile:{id:'user',user_id:'user',tenant_id:'tenant'},user:{id:'user'},loading:false,signOut:async()=>{}});export const AuthProvider=({children})=>children;`,
        });
      if (u.pathname.includes("/rest/v1/")) {
        const name = u.pathname.split("/").pop();
        let data = [];
        if (name === "products") data = products;
        if (name === "tenants") data = { name: "Teste", settings: {} };
        if (name === "assembly_product_status") data = status;
        if (name === "product_piece_spec") data = technical;
        if (name === "product_material_recipe_preview")
          data = {
            product: products[0],
            plates: [],
            components: [],
            recipe: null,
            requirements: [],
            missing: [],
            complete: false,
          };
        if (name === "jobs") data = [job];
        if (name === "product_print_plates")
          data = [
            {
              id: id(40),
              product_id: id(1),
              label: "Placa mista",
              plate_index: 1,
              units_per_plate: 1,
            },
          ];
        if (
          [
            "move_subitem_stock",
            "assemble_product",
            "plan_subitem_batch",
            "confirm_subitem_output",
            "save_product_subitem",
            "save_product_piece_spec",
          ].includes(name)
        ) {
          writes.push({ name, payload: route.request().postDataJSON() });
          data = id(99);
        }
        return route.fulfill({
          contentType: "application/json",
          body: JSON.stringify(data),
        });
      }
      if (!["127.0.0.1", "localhost"].includes(u.hostname))
        return route.abort();
      return route.continue();
    });
    await page.goto(`${base}/producao/componentes?produto=${id(1)}`);
    await expect(
      page.getByRole("region", { name: "Estoque individual e montagem" }),
    ).toBeVisible();
    await expect(
      page.getByRole("article", { name: "Estoque de Metade da maçã" }),
    ).toContainText("2 un por produto");
    const half = page.getByRole("article", {
      name: "Estoque de Metade da maçã",
    });
    await half
      .getByRole("button", { name: "Entrada de peças", exact: true })
      .click();
    await page.getByLabel("Quantidade de peças", { exact: true }).fill("7");
    await page.getByLabel("Custo por peça (R$)", { exact: true }).fill("1,50");
    await page
      .getByLabel("Motivo da movimentação", { exact: true })
      .fill("Contagem física");
    await page
      .getByRole("button", { name: "Confirmar peças", exact: true })
      .click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].payload.p_component_product_id).toBe(
      parts[0].component_product_id,
    );
    expect(writes[0].payload.p_quantity).toBe(7);
    expect(writes[0].payload.p_unit_cost).toBe(1.5);
    await page
      .getByRole("button", { name: "Montar produto final", exact: true })
      .click();
    await page
      .getByLabel("Produtos finais a montar", { exact: true })
      .fill("5");
    await expect(page.getByRole("dialog")).toContainText("10 × Metade da maçã");
    await expect(page.getByRole("dialog")).toContainText("5 × Caule");
    await page.screenshot({
      path: `${output}/assembly-${width}.png`,
      animations: "disabled",
    });
    await page
      .getByRole("button", { name: "Confirmar montagem", exact: true })
      .click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1].payload.p_quantity).toBe(5);
    await expect(page.getByRole("dialog")).toBeHidden();
    await page
      .getByRole("button", { name: "Conferir OI-TESTE", exact: true })
      .click();
    await page
      .getByLabel("Metade da maçã — boas de 10 previstas", { exact: true })
      .fill("9");
    await page
      .getByLabel("Folha — boas de 5 previstas", { exact: true })
      .fill("4");
    await page
      .getByLabel("Motivo das rejeições (se houver)", { exact: true })
      .fill("Uma metade e uma folha deformadas");
    await page
      .getByRole("button", { name: "Confirmar peças", exact: true })
      .click();
    await expect.poll(() => writes.length).toBe(3);
    expect(writes[2].payload.p_outputs.map((o) => o.good_quantity)).toEqual([
      9, 5, 4,
    ]);
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.screenshot({
      path: `${output}/stock-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await page.goto(`${base}/comercial/produtos?produto=${id(1)}`);
    await expect(page.getByRole("dialog"))
      .toBeVisible()
      .catch(async (e) => {
        console.log(errors, await page.locator("body").innerText());
        await page.screenshot({
          path: "artifacts/subitems/catalogue-error.png",
        });
        throw e;
      });
    await page.getByRole("tab", { name: /Composição/ }).click();
    await expect(
      page.getByRole("region", { name: "Subitens com estoque próprio" }),
    ).toContainText("Metade da maçã");
    await page
      .getByRole("button", { name: "Cadastrar subitem", exact: true })
      .click();
    await page
      .getByLabel("Nome da peça", { exact: true })
      .fill("Laço decorativo");
    await page.getByLabel("Estoque inicial da peça", { exact: true }).fill("7");
    await page.getByLabel("Custo por peça (R$)", { exact: true }).fill("2,50");
    await page
      .getByText("Filamento, tempo e ficha técnica da peça", { exact: true })
      .click();
    await page
      .getByLabel("Filamento por peça (g)", { exact: true })
      .fill("3,5");
    await page
      .getByLabel("Impressão por peça (min)", { exact: true })
      .fill("8");
    await page
      .getByLabel("Quantas unidades desta peça formam um produto?", {
        exact: true,
      })
      .fill("2");
    await page
      .getByRole("button", { name: "Salvar subitem", exact: true })
      .click();
    await expect.poll(() => writes.length).toBe(4);
    expect(writes[3].payload.p_data).toMatchObject({
      name: "Laço decorativo",
      initial_stock: 7,
      unit_cost: 2.5,
      quantity_per_product: 2,
      plate_id: null,
      technical: { print_seconds: 480, materials: [{ grams: 3.5 }] },
    });
    await page
      .getByRole("button", { name: "Cadastrar subitem", exact: true })
      .click();
    await page
      .getByLabel("Nome da peça", { exact: true })
      .fill("Rascunho do produto pai");
    await page
      .getByRole("article")
      .filter({ hasText: "Metade da maçã" })
      .getByRole("link", { name: "Abrir cadastro da peça", exact: true })
      .click();
    await expect(page.getByLabel("Nome *", { exact: true })).toHaveValue(
      "Metade da maçã",
    );
    await expect(
      page.getByRole("button", { name: "Salvar", exact: true }),
    ).toBeEnabled();
    await page.getByRole("tab", { name: /Composição/ }).click();
    await page
      .getByRole("button", { name: "Ficha técnica", exact: true })
      .click();
    const specDialog = page.getByRole("dialog", {
      name: "Ficha técnica — Metade da maçã",
      exact: true,
    });
    await expect(specDialog).toBeVisible();
    await specDialog
      .getByLabel("Peso e tempo informados para", { exact: true })
      .selectOption("plate");
    await specDialog
      .getByLabel("Peças iguais por placa (opcional)", { exact: true })
      .fill("20");
    await specDialog
      .getByLabel("Filamento da placa (g)", { exact: true })
      .fill("55,5");
    await specDialog
      .getByLabel("Impressão da placa (min)", { exact: true })
      .fill("90");
    await page.screenshot({
      path: `${output}/technical-${width}.png`,
      animations: "disabled",
    });
    await specDialog
      .getByRole("button", { name: "Salvar ficha técnica", exact: true })
      .click();
    await expect.poll(() => writes.length).toBe(5);
    expect(writes[4].payload.p_product_id).toBe(parts[0].component_product_id);
    expect(writes[4].payload.p_data.print_seconds).toBe(270);
    expect(writes[4].payload.p_data.materials[0].grams).toBe(2.775);
    await expect(specDialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Salvar", exact: true }),
    ).toBeEnabled();
    expect(errors).toEqual([]);
    console.log(
      `PASS physical subitem UI ${width}px: independent entry, assembly consumption preview, per-part QC and catalogue creation`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
