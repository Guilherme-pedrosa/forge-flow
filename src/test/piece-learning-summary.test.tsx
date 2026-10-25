import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PieceTechnicalSummary } from "@/components/production/PieceTechnicalSheet";

afterEach(cleanup);
const reference={sample_units:12,sample_runs:3,file_sha256:"a".repeat(64),project_key:"project-1",updated_at:"2026-10-25T12:00:00Z",consumption_source:"slicer_completed" as const,time_source:"elapsed_start_end" as const};
const values={revision:null,materials:[{item_id:null,material:"PLA",color:"Verde",grams:3,cost_per_kg:null}],grams:3,print_seconds:120};
describe("piece technical reference provenance",()=>{
  it("identifies Bambu estimates and elapsed time separately from measured consumption",()=>{
    render(<PieceTechnicalSummary spec={{...values,source:"bambu",learned_reference:reference}}/>);
    expect(screen.getByText("12 peças em 3 impressões.")).toBeInTheDocument();
    expect(screen.getByText("Peso informado pelo fatiador Bambu em impressões concluídas.")).toBeInTheDocument();
    expect(screen.getByText("Tempo decorrido entre início e fim.")).toBeInTheDocument();
    expect(screen.queryByText("Consumo medido na apuração.")).not.toBeInTheDocument();
  });
  it("labels a measured Bambu reference without changing its values",()=>{
    render(<PieceTechnicalSummary spec={{...values,source:"bambu",learned_reference:{...reference,consumption_source:"measured",time_source:"confirmed_elapsed"}}}/>);
    expect(screen.getByText("Consumo medido na apuração.")).toBeInTheDocument();
    expect(screen.getByText("Tempo decorrido confirmado na apuração.")).toBeInTheDocument(); expect(screen.getByText("3 g")).toBeInTheDocument();
  });
  it("keeps a manual sheet visibly authoritative even if reference metadata is supplied",()=>{
    render(<PieceTechnicalSummary spec={{...values,source:"manual",grams:9,learned_reference:reference}}/>);
    expect(screen.getByText("Ficha técnica informada manualmente para este SKU.")).toBeInTheDocument(); expect(screen.getByText("9 g")).toBeInTheDocument();
    expect(screen.queryByText("Referência Bambu de impressões aprovadas no QC")).not.toBeInTheDocument();
  });
  it("keeps the file plan distinct from approved execution learning",()=>{
    render(<PieceTechnicalSummary spec={{...values,source:"plate"}}/>);
    expect(screen.getByText(/Estimativa do plano de impressão/)).toBeInTheDocument();
    expect(screen.queryByText("Referência Bambu de impressões aprovadas no QC")).not.toBeInTheDocument();
  });
});
