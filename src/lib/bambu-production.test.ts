import { describe, expect, it } from "vitest";
import { bambuMeasurementDefaults, bambuTaskStatus, type BambuMeasurementSource } from "./bambu-production";

const task: BambuMeasurementSource = {
  status: "2", weight_grams: 55.63, cost_time_seconds: 12324,
  start_time: "2026-09-13T10:00:00Z", end_time: "2026-09-13T10:01:17Z",
};

describe("apuração de uma tentativa Bambu", () => {
  it.each(["1", "4"])("status %s continua em andamento mesmo com endTime no snapshot", status => {
    expect(bambuMeasurementDefaults({ ...task, status })).toMatchObject({ terminal: false, elapsedSeconds: null, suggestedGrams: null });
  });
  it.each(["0", "5", "PRINTING", null, undefined])("estado desconhecido %s não autoriza apuração", status => {
    expect(bambuTaskStatus(status)).toMatchObject({ terminal: false, outcome: null, label: "Desconhecido" });
  });
  it("separa 77 segundos decorridos do plano de 12324 segundos", () => {
    expect(bambuMeasurementDefaults(task)).toMatchObject({ elapsedSeconds: 77, plannedSeconds: 12324, suggestedGrams: 55.63, gramsBasis: "slicer" });
  });
  it("falha pede pesagem e nunca sugere baixar o peso integral do fatiador", () => {
    expect(bambuMeasurementDefaults({ ...task, status: "3" })).toMatchObject({ terminal: true, outcome: "failed", suggestedGrams: null, gramsBasis: null, plannedGrams: 55.63 });
  });
  it.each([null, "invalid", "2026-09-13T10:00:00Z", "2026-09-13T09:59:59Z"])("horário final inválido %s não vira tempo real zero", end_time => {
    expect(bambuMeasurementDefaults({ ...task, end_time }).elapsedSeconds).toBeNull();
  });
  it.each([NaN, Infinity, -1])("peso inválido %s não vira uma sugestão de consumo", weight_grams => {
    expect(bambuMeasurementDefaults({ ...task, weight_grams }).suggestedGrams).toBeNull();
  });
});
