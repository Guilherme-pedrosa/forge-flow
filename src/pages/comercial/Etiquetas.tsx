import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/PageHeader";
import { SearchableItemSelect } from "@/components/shared/SearchableItemSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { allRows } from "@/lib/finance";
import {
  labelQr,
  productLabelsPdf,
  validateLabels,
  type ProductLabel,
  type LabelOptions,
} from "@/lib/product-labels";
export default function Etiquetas() {
  const [labels, setLabels] = useState<(ProductLabel & { id: string })[]>([]);
  const [options, setOptions] = useState<LabelOptions>({
    mode: "none",
    url: "",
    pixKey: "",
    receiver: "",
    city: "",
    pixAmount: false,
    showPrice: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [qr, setQr] = useState("");
  const products = useQuery({
    queryKey: ["label-products"],
    queryFn: () =>
      allRows((a, b) =>
        supabase
          .from("products")
          .select("id,name,sku,sale_price")
          .eq("is_active", true)
          .order("name")
          .order("id")
          .range(a, b),
      ),
  });
  const validation = useMemo(() => {
    try {
      return { count: validateLabels(labels, options), error: "" };
    } catch (e) {
      return { count: 0, error: (e as Error).message };
    }
  }, [labels, options]);
  const first = labels[0];
  useEffect(() => {
    let active = true;
    setQr("");
    if (first && !validation.error) {
      const payload = labelQr(first, options);
      if (payload)
        void import("qrcode")
          .then((q) =>
            q.toDataURL(payload, {
              margin: 4,
              width: 240,
              errorCorrectionLevel: "M",
            }),
          )
          .then((url) => {
            if (active) setQr(url);
          })
          .catch(() => {
            if (active) setError("Não foi possível gerar a prévia do QR.");
          });
    }
    return () => {
      active = false;
    };
  }, [first, options, validation.error]);
  const field = (
    key: "url" | "pixKey" | "receiver" | "city",
    label: string,
    placeholder?: string,
  ) => (
    <div>
      <Label htmlFor={`label-${key}`}>{label}</Label>
      <Input
        id={`label-${key}`}
        value={options[key]}
        placeholder={placeholder}
        onChange={(e) => setOptions({ ...options, [key]: e.target.value })}
      />
    </div>
  );
  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        title="Etiquetas de produtos"
        description="Baixe etiquetas em PDF com nome, SKU, preço e QR. Folha A4, 18 etiquetas de 62 × 44 mm; imprimir em tamanho real."
        breadcrumbs={[{ label: "Comercial" }, { label: "Etiquetas" }]}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 space-y-4 rounded-xl border bg-card p-4">
          <SearchableItemSelect
            value=""
            label="Produto para etiqueta"
            emptyLabel="Buscar produto para adicionar"
            searchPlaceholder="Digite nome ou SKU..."
            options={(products.data || []).map((p) => ({
              id: p.id,
              label: p.name,
              description: p.sku || undefined,
            }))}
            onChange={(id) => {
              const p = products.data?.find((p) => p.id === id);
              if (p)
                setLabels((current) =>
                  current.some((l) => l.id === id)
                    ? current.map((l) =>
                        l.id === id ? { ...l, quantity: l.quantity + 1 } : l,
                      )
                    : [
                        ...current,
                        {
                          id: p.id,
                          name: p.name,
                          sku: p.sku || "",
                          price: p.sale_price || 0,
                          quantity: 1,
                        },
                      ],
                );
            }}
          />
          {products.error && <p role="alert">Falha ao carregar produtos.</p>}
          {labels.map((label, i) => (
            <article key={label.id} className="space-y-3 rounded-lg border p-3">
              <strong className="break-words">{label.name}</strong>
              <p className="text-xs text-muted-foreground">
                {label.sku || "Sem SKU"}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor={`label-price-${i}`}>Preço (R$)</Label>
                  <Input
                    id={`label-price-${i}`}
                    type="number"
                    min={0}
                    step=".01"
                    value={Number.isNaN(label.price) ? "" : label.price}
                    onChange={(e) =>
                      setLabels(
                        labels.map((l, j) =>
                          j === i
                            ? {
                                ...l,
                                price:
                                  e.target.value === ""
                                    ? NaN
                                    : Number(e.target.value),
                              }
                            : l,
                        ),
                      )
                    }
                  />
                </div>
                <div>
                  <Label htmlFor={`label-qty-${i}`}>
                    Quantidade de etiquetas
                  </Label>
                  <Input
                    id={`label-qty-${i}`}
                    type="number"
                    min={1}
                    max={500}
                    value={Number.isNaN(label.quantity) ? "" : label.quantity}
                    onChange={(e) =>
                      setLabels(
                        labels.map((l, j) =>
                          j === i
                            ? {
                                ...l,
                                quantity:
                                  e.target.value === ""
                                    ? NaN
                                    : Number(e.target.value),
                              }
                            : l,
                        ),
                      )
                    }
                  />
                </div>
              </div>
              <Button
                variant="ghost"
                onClick={() => setLabels(labels.filter((_, j) => j !== i))}
              >
                Remover
              </Button>
            </article>
          ))}
          {!labels.length && (
            <p className="py-10 text-center text-muted-foreground">
              Escolha os produtos para montar as etiquetas.
            </p>
          )}
        </section>
        <aside className="h-fit space-y-4 rounded-xl border bg-card p-4">
          <h2 className="font-semibold">Conteúdo e prévia</h2>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={options.showPrice}
              onChange={(e) =>
                setOptions({ ...options, showPrice: e.target.checked })
              }
            />
            Mostrar preço
          </label>
          <div>
            <Label htmlFor="label-mode">QR da etiqueta</Label>
            <select
              id="label-mode"
              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
              value={options.mode}
              onChange={(e) =>
                setOptions({
                  ...options,
                  mode: e.target.value as LabelOptions["mode"],
                })
              }
            >
              <option value="none">Sem QR</option>
              <option value="url">Endereço / catálogo / WhatsApp</option>
              <option value="pix">Pix estático</option>
            </select>
          </div>
          {options.mode === "url" &&
            field("url", "Endereço HTTPS", "https://...")}
          {options.mode === "pix" && (
            <>
              {field("pixKey", "Chave Pix")}
              {field("receiver", "Nome do recebedor (até 25 caracteres)")}
              {field("city", "Cidade (até 15 caracteres)")}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={options.pixAmount}
                  onChange={(e) =>
                    setOptions({ ...options, pixAmount: e.target.checked })
                  }
                />
                Incluir preço unitário no Pix
              </label>
              <p className="text-xs text-muted-foreground">
                Confira o recebedor no aplicativo do banco ao ler o QR. Gerar a
                etiqueta não registra pagamento no financeiro.
              </p>
            </>
          )}
          {first && (
            <div className="rounded-lg border-2 border-dashed bg-white p-4 text-black">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-semibold">
                    {first.name}
                  </p>
                  <p className="mt-3 break-all text-xs">
                    {first.sku || "Sem SKU"}
                  </p>
                  {options.showPrice && (
                    <strong className="mt-2 block">
                      {first.price.toLocaleString("pt-BR", {
                        style: "currency",
                        currency: "BRL",
                      })}
                    </strong>
                  )}
                </div>
                {qr && (
                  <img
                    src={qr}
                    alt="Prévia do QR da etiqueta"
                    className="h-24 w-24"
                  />
                )}
              </div>
            </div>
          )}
          {validation.error && labels.length > 0 && (
            <p role="alert" className="text-sm text-destructive">
              {validation.error}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            className="w-full"
            disabled={busy || !!validation.error}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const pdf = await productLabelsPdf(labels, options);
                pdf.save("etiquetas-produtos.pdf");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? "Gerando PDF…"
              : `Baixar PDF${validation.count ? ` · ${validation.count} etiquetas` : ""}`}
          </Button>
          <p className="text-xs text-muted-foreground">
            Faça uma impressão de teste em escala 100% antes de usar a folha de
            etiquetas.
          </p>
        </aside>
      </div>
    </div>
  );
}
