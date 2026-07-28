import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { ArrowCounterClockwiseIcon as ArrowCounterClockwise } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ArrowRightIcon as ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CaretDownIcon as CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckCircleIcon as CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { CubeIcon as Cube } from "@phosphor-icons/react/dist/csr/Cube";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { FolderSimpleIcon as FolderSimple } from "@phosphor-icons/react/dist/csr/FolderSimple";
import { LockKeyIcon as LockKey } from "@phosphor-icons/react/dist/csr/LockKey";
import { SpinnerGapIcon as SpinnerGap } from "@phosphor-icons/react/dist/csr/SpinnerGap";
import { WarningCircleIcon as WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { XCircleIcon as XCircle } from "@phosphor-icons/react/dist/csr/XCircle";
import type { DetectedTool, SetupApiClient, SetupDetection, SetupResult, ToolId, WizardPhase } from "./types.js";
import { sameOriginSetupClient } from "./api.js";

const demoDetection: SetupDetection = {
  sources: [{ id: "page-wiki", name: "Jaeman’s Page / Wiki", path: "~/Documents/Jaeman’s Page", noteCount: 194, validation: "valid" }],
  tools: [{ id: "codex", name: "Codex", status: "ready" }, { id: "claude-code", name: "Claude Code", status: "ready" }],
};

export interface SetupWizardProps {
  client?: SetupApiClient;
  /** Lets hosts provide a file-picker; the browser UI otherwise shows detected choices. */
  onChooseFolder?: () => Promise<SetupDetection | undefined>;
  onComplete?: (result: SetupResult) => void;
  initialDetection?: SetupDetection;
  /** Useful for host-driven restoration and deterministic visual previews. */
  initialPhase?: Exclude<WizardPhase, "detecting" | "connecting">;
  initialMessage?: string;
}

export function SetupWizard({ client = sameOriginSetupClient, initialDetection, initialPhase, initialMessage, onChooseFolder, onComplete }: SetupWizardProps) {
  const [phase, setPhase] = useState<WizardPhase>(initialPhase ?? (initialDetection ? phaseFor(initialDetection) : "detecting"));
  const [detection, setDetection] = useState<SetupDetection | undefined>(initialDetection);
  const [selectedSource, setSelectedSource] = useState<string | undefined>(initialDetection?.sources[0]?.id);
  const [selectedTools, setSelectedTools] = useState<ToolId[]>(initialDetection?.tools.filter((tool) => tool.status === "ready").map((tool) => tool.id) ?? []);
  const [advanced, setAdvanced] = useState(false);
  const [message, setMessage] = useState<string | undefined>(initialMessage);
  const advancedId = useId();

  const source = useMemo(() => detection?.sources.find((item) => item.id === selectedSource), [detection, selectedSource]);
  const alreadyComplete =
    Boolean(detection?.tools.length) &&
    detection?.tools.every(
      (tool) => tool.status === "connected" || tool.status === "unavailable",
    );

  useEffect(() => {
    if (initialDetection || initialPhase) return;
    const controller = new AbortController();
    client.detect(controller.signal).then(applyDetection).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "We couldn’t inspect this device.");
      setPhase("error");
    });
    return () => controller.abort();
  }, [client, initialDetection]);

  function applyDetection(next: SetupDetection) {
    setDetection(next);
    setSelectedSource(next.sources[0]?.id);
    setSelectedTools(next.tools.filter((tool) => tool.status === "ready").map((tool) => tool.id));
    setPhase(phaseFor(next));
  }

  async function retryDetection() {
    setPhase("detecting"); setMessage(undefined);
    try { applyDetection(await client.detect()); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Detection failed."); setPhase("error"); }
  }

  async function changeFolder() {
    const choose = onChooseFolder ?? client.chooseFolder;
    if (!choose) { setPhase("choosing-source"); return; }
    try {
      const next = await choose();
      if (next) applyDetection(next);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Couldn’t open the folder picker."); }
  }

  async function connect() {
    if (!source || selectedTools.length === 0) return;
    setPhase("connecting"); setMessage(undefined);
    try {
      const result = await client.connect({ sourceId: source.id, toolIds: selectedTools, includeHiddenFiles: false });
      onComplete?.(result);
      setPhase(result.failed.length ? "partial" : "success");
      if (result.failed.length) setMessage(result.failed.map((item) => item.message).join(" "));
    } catch (error) { setMessage(error instanceof Error ? error.message : "The connection couldn’t be completed."); setPhase("error"); }
  }

  if (phase === "detecting") return <WizardShell step={1}><StatusPanel icon={<SpinnerGap className="spin" />} title="Looking for your knowledge base" detail="We’re checking for Markdown folders and compatible coding tools on this device." /></WizardShell>;
  if (phase === "missing") return <WizardShell step={1}><StatusPanel icon={<FolderSimple />} title="Choose a knowledge folder" detail="We couldn’t find a Markdown knowledge base automatically. Select a local folder to continue." action={<button className="button" onClick={changeFolder}><FolderOpenIcon />Choose folder</button>} /></WizardShell>;
  if (phase === "error") return <WizardShell step={1}><StatusPanel icon={<WarningCircle />} title="We couldn’t finish detection" detail={message ?? "Try again, or choose a knowledge folder manually."} action={<><button className="button secondary" onClick={retryDetection}><ArrowCounterClockwise />Try again</button><button className="text-button" onClick={changeFolder}>Choose folder</button></>} /></WizardShell>;
  if (phase === "connecting") return <WizardShell step={3}><StatusPanel icon={<SpinnerGap className="spin" />} title="Connecting your tools" detail="Personal Context is preparing a local, read-only connection. This only takes a moment." /></WizardShell>;
  if (phase === "success") return <WizardShell step={3}><StatusPanel icon={<CheckCircle />} title="You’re all set" detail="Your personal context is now available to your connected tools on this device." action={<button className="button" onClick={() => void client.finish?.()}>Done</button>} /></WizardShell>;

  return <WizardShell step={phase === "choosing-source" ? 1 : 2}>
    <header className="hero"><h1>{phase === "partial" ? "Some tools need your attention" : "Personal Context found what it needs"}</h1><p>{phase === "partial" ? "Your knowledge source is connected. You can retry the remaining tools." : "We detected your local knowledge base and the tools we can connect. Review and connect in one click."}</p></header>
    {phase === "partial" && <div className="notice"><WarningCircle />{message ?? "One or more connections couldn’t be completed."}</div>}
    <section className="group"><h2>{phase === "choosing-source" ? "Choose a knowledge source" : "Knowledge source"}</h2>
      {detection?.sources.map((item) => <SourceRow key={item.id} source={item} selected={selectedSource === item.id} selectable={phase === "choosing-source"} onSelect={() => { setSelectedSource(item.id); if (phase === "choosing-source") setPhase("review"); }} />)}
    </section>
    {phase !== "choosing-source" && <section className="group"><h2>Tools to connect</h2>{detection?.tools.map((tool) => <ToolRow key={tool.id} tool={tool} checked={selectedTools.includes(tool.id)} onToggle={() => setSelectedTools((current) => current.includes(tool.id) ? current.filter((id) => id !== tool.id) : [...current, tool.id])} />)}</section>}
    {phase !== "choosing-source" && <>
      <aside className="privacy"><LockKey /><div><strong>Your data stays local.</strong><p>Personal Context reads Markdown files from your device only. The MCP connection is read-only. <a href="#privacy">Learn more</a></p></div></aside>
      <button className="advanced" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced} aria-controls={advancedId}>Advanced <CaretDown className={advanced ? "up" : ""} /></button>
      {advanced && <div id={advancedId} className="advanced-panel"><strong>Knowledge path</strong><code>{source?.path}</code><span>Hidden folders are skipped. The managed runtime and client commands are verified during connection.</span>{detection?.tools.filter((tool) => tool.connectionDifference).map((tool) => <section className="connection-difference" key={tool.id} aria-label={`${tool.name} connection difference`}><strong>{tool.name} replacement</strong><span>{tool.connectionDifference?.current}</span><span>{tool.connectionDifference?.proposed}</span><ul>{tool.connectionDifference?.changes.map((change) => <li key={change}>{change}</li>)}</ul><span>Raw arguments are intentionally hidden because another connection can contain credentials.</span></section>)}</div>}
      <footer><button className="text-button change-folder" onClick={changeFolder}>Change knowledge folder</button><button className="button" disabled={!alreadyComplete && (!source || selectedTools.length === 0)} onClick={alreadyComplete ? () => void client.finish?.() : connect}>{alreadyComplete ? "Done" : phase === "partial" ? "Retry connection" : `Connect ${toolLabel(selectedTools)}`}<ArrowRight /></button></footer>
    </>}
  </WizardShell>;
}

function WizardShell({ step, children }: { step: number; children: ReactNode }) { return <main className="setup-wizard"><div className="brand"><Cube weight="duotone" /> <span>Personal Context</span></div><nav aria-label="Setup progress">{["Detect", "Review", "Connect"].map((label, index) => <div className={index + 1 === step ? "active" : index + 1 < step ? "done" : ""} key={label}><b>{index + 1}</b><span>{label}</span>{index < 2 && <i />}</div>)}</nav>{children}</main>; }
function StatusPanel({ icon, title, detail, action }: { icon: ReactNode; title: string; detail: string; action?: ReactNode }) { return <section className="status-panel"><div className="status-icon">{icon}</div><h1>{title}</h1><p>{detail}</p>{action && <div className="status-actions">{action}</div>}</section>; }
function SourceRow({ source, selected, selectable, onSelect }: { source: SetupDetection["sources"][number]; selected: boolean; selectable: boolean; onSelect: () => void }) { return <button className={`row source-row ${selectable ? "selectable" : ""} ${selected ? "selected" : ""}`} onClick={onSelect} disabled={!selectable}><FolderSimple /><strong>{source.name}</strong><span>{source.noteCount} knowledge notes</span><em className={source.validation}>{source.validation === "valid" ? <CheckCircle /> : <WarningCircle />}{source.validation === "valid" ? "Validated" : "Needs review"}</em></button>; }
function ToolRow({ tool, checked, onToggle }: { tool: DetectedTool; checked: boolean; onToggle: () => void }) {
  const available = tool.status !== "unavailable";
  const connected = tool.status === "connected";
  const conflict = tool.status === "conflict";
  const detail = tool.detail ?? (connected ? "Already connected" : conflict ? "Different setup — review in Advanced" : available ? "Detected" : "Not found");
  return <label className={`row tool-row ${conflict ? "has-control" : ""} ${!available ? "unavailable" : ""}`} title={tool.detail}>{conflict && <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Replace ${tool.name} connection`} />}<span className="tool-icon">{tool.id === "codex" ? <Cube weight="fill" /> : "AI"}</span><strong>{tool.name}</strong><span>{detail}</span><em className={available && !conflict ? "valid" : conflict ? "warning" : "invalid"}>{available && !conflict ? <CheckCircle /> : conflict ? <WarningCircle /> : <XCircle />}{connected ? "Connected" : conflict ? "Review" : available ? "Ready" : "Unavailable"}</em></label>;
}
function toolLabel(tools: ToolId[]) { return tools.length === 2 ? "Codex & Claude" : tools[0] === "codex" ? "Codex" : "Claude"; }
function phaseFor(detection: SetupDetection): WizardPhase { return detection.sources.length === 0 ? "missing" : detection.sources.length > 1 ? "choosing-source" : "review"; }

/** A no-server preview mode, useful for Storybook and visual review. */
export const setupPreviewDetection = demoDetection;
