import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { parseModelFile, disposeModel, type ModelFile } from "@/lib/model-file";
import type { ImportedComposition } from "@/lib/imported-composition";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

function ModelCanvas({
  model,
  selected,
  onSelect,
}: {
  model: ModelFile;
  selected: string;
  onSelect: (key: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const callback = useRef(onSelect);
  callback.current = onSelect;
  const [error, setError] = useState("");
  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError(
        "A visualização 3D não está disponível neste navegador. Você pode conferir e usar a lista de peças.",
      );
      return;
    }
    setError("");
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#eef3f4");
    scene.add(new THREE.HemisphereLight(0xffffff, 0x52636a, 2.8));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(100, 200, 250);
    scene.add(light);
    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2;
    root.add(model.group);
    scene.add(root);
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    const camera = new THREE.PerspectiveCamera(40, 1, size / 1000, size * 100);
    camera.position.copy(center).add(new THREE.Vector3(size, size * 0.7, size));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(center);
    controls.enableDamping = true;
    const resize = new ResizeObserver(() => {
      const width = element.clientWidth;
      const height = 320;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    });
    resize.observe(element);
    let down = { x: 0, y: 0 };
    const pointerDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY };
    };
    const pick = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5)
        return;
      const bounds = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
          (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
        ),
        camera,
      );
      let object: THREE.Object3D | null = ray.intersectObject(root, true)[0]
        ?.object;
      while (object && !object.userData.partKey) object = object.parent;
      if (object) callback.current(object.userData.partKey);
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pick);
    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      controls.update();
      renderer.render(scene, camera);
    };
    draw();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      root.remove(model.group);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [model]);
  useEffect(() => {
    model.group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      let parent: THREE.Object3D | null = object;
      while (parent && !parent.userData.partKey) parent = parent.parent;
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material])
        if (material instanceof THREE.MeshStandardMaterial)
          material.color.set(
            parent?.userData.partKey === selected ? "#edaa36" : "#4c9086",
          );
    });
  }, [model, selected]);
  return (
    <>
      <div
        ref={host}
        className="min-h-[320px] overflow-hidden rounded-lg"
        aria-label="Modelo 3D interativo"
      />
      {error && (
        <p role="status" className="text-sm">
          {error}
        </p>
      )}
    </>
  );
}

export default function ModelFileInput({
  current,
  onChange,
  onBusyChange,
  disabled = false,
}: {
  current?: ImportedComposition;
  onChange: (value: ImportedComposition) => void;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const [model, setModel] = useState<ModelFile | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState("");
  const [used, setUsed] = useState(false);
  const sequence = useRef(0);
  const activeModel = useRef<ModelFile | null>(null);
  useEffect(
    () => () => {
      sequence.current++;
      if (activeModel.current) disposeModel(activeModel.current.group);
    },
    [],
  );
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  return (
    <section
      className="space-y-3 rounded-lg border p-3"
      aria-label="Arquivo de impressão"
    >
      <Label htmlFor="visual-model-file">
        {current
          ? "Visualizar e completar pelo arquivo 3MF"
          : "Abrir projeto 3MF ou peça STL"}
      </Label>
      <Input
        id="visual-model-file"
        type="file"
        accept={current ? ".3mf" : ".3mf,.stl"}
        disabled={busy || disabled}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const version = ++sequence.current;
          setBusy(true);
          setError("");
          setUsed(false);
          try {
            if (file.size > 80 * 1024 * 1024)
              throw new Error("Use um arquivo de até 80 MB.");
            const bytes = new Uint8Array(await file.arrayBuffer());
            if (version !== sequence.current) return;
            const loaded = parseModelFile(bytes, file.name, current);
            if (!current) {
              const hash = await crypto.subtle.digest("SHA-256", bytes);
              loaded.composition.profile_id = `local:${Array.from(
                new Uint8Array(hash),
              )
                .map((b) => b.toString(16).padStart(2, "0"))
                .join("")}`;
            }
            if (version !== sequence.current) {
              disposeModel(loaded.group);
              return;
            }
            if (activeModel.current) disposeModel(activeModel.current.group);
            activeModel.current = loaded;
            setModel(loaded);
            setSelected("");
          } catch (e) {
            if (version === sequence.current) setError((e as Error).message);
          } finally {
            if (version === sequence.current) setBusy(false);
          }
        }}
      />
      <p className="text-xs text-muted-foreground">
        Leitura local. Arraste para girar, use a roda para aproximar e clique em
        uma peça. Cores são agrupadas no mesmo objeto físico. Arquivos STL não
        informam placas, rendimento ou nomes internos.
      </p>
      {busy && <p role="status">Lendo geometria e composição…</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {model && (
        <>
          <ModelCanvas
            model={model}
            selected={selected}
            onSelect={setSelected}
          />
          <div className="flex flex-wrap gap-2">
            {model.composition.plates.flatMap((p) =>
              p.parts.map((part) => (
                <Button
                  key={`${p.index}:${part.source_key}`}
                  type="button"
                  variant={selected === part.source_key ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelected(part.source_key)}
                >
                  {part.name} · placa {p.index} · {part.quantity_per_plate} un.
                </Button>
              )),
            )}
          </div>
          <Button
            type="button"
            disabled={busy || used}
            onClick={() => {
              onChange(model.composition);
              setUsed(true);
            }}
          >
            Usar estas peças no produto
          </Button>
          {used && (
            <p role="status" className="text-sm">
              Composição aplicada ao formulário. Confira as quantidades por
              produto e salve o cadastro.
            </p>
          )}
        </>
      )}
    </section>
  );
}
