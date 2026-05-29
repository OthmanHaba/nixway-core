"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserFrame } from "./demo/BrowserFrame";
import { ConsoleChrome, type DemoPage } from "./demo/ConsoleChrome";
import { SceneServers } from "./demo/SceneServers";
import { SceneClusters } from "./demo/SceneClusters";
import { SceneProjects } from "./demo/SceneProjects";
import { SceneApp } from "./demo/SceneApp";
import { SceneDeploy } from "./demo/SceneDeploy";
import { SceneOverview } from "./demo/SceneOverview";
import { StepNav } from "./demo/StepNav";

/* The full operator-console walkthrough. Six scenes, BrowserFrame
   wrapper, IntersectionObserver pause when off-screen, tighter
   per-scene timings, scene-direction-aware slide transitions. */

interface Scene {
  id: string;
  label: string;
  page: DemoPage;
  url: string;
  durationMs: number;
  render: () => React.ReactNode;
}

const SCENES: Scene[] = [
  {
    id: "servers",
    label: "Add a server",
    page: "servers",
    url: "console.orbit.co/servers",
    durationMs: 5200,
    render: () => <SceneServers />,
  },
  {
    id: "clusters",
    label: "Form the mesh",
    page: "clusters",
    url: "console.orbit.co/clusters/prod-edge",
    durationMs: 5400,
    render: () => <SceneClusters />,
  },
  {
    id: "projects",
    label: "Connect a repo",
    page: "projects",
    url: "console.orbit.co/projects/new",
    durationMs: 3800,
    render: () => <SceneProjects />,
  },
  {
    id: "app",
    label: "Add an app",
    page: "projects",
    url: "console.orbit.co/projects/orbit-api",
    durationMs: 3600,
    render: () => <SceneApp />,
  },
  {
    id: "deploy",
    label: "Ship to prod",
    page: "projects",
    url: "console.orbit.co/projects/orbit-api/deploys/v124",
    durationMs: 7400,
    render: () => <SceneDeploy />,
  },
  {
    id: "overview",
    label: "Mission control",
    page: "overview",
    url: "console.orbit.co",
    durationMs: 4400,
    render: () => <SceneOverview />,
  },
];

export function LiveDemo() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [progress, setProgress] = useState(0);
  const [direction, setDirection] = useState<"forward" | "back">("forward");

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  /* Pause when the demo scrolls out of view. Threshold 0.35 so it
     starts as soon as a third of the panel is on screen, and pauses
     once two-thirds have left. */
  useEffect(() => {
    const node = wrapRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        setVisible(entries[0]?.isIntersecting ?? true);
      },
      { threshold: 0.35 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, []);

  /* Drive the active step's timer. Resets on step / pause / visibility. */
  useEffect(() => {
    if (paused || !visible) return;
    const duration = SCENES[step].durationMs;
    startedAtRef.current = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startedAtRef.current;
      const p = Math.min(1, elapsed / duration);
      setProgress(p);
      if (p >= 1) {
        setDirection("forward");
        setStep((s) => (s + 1) % SCENES.length);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [step, paused, visible]);

  const jumpTo = (i: number) => {
    setDirection(i > step ? "forward" : "back");
    setStep(i);
  };

  const current = SCENES[step];

  return (
    <section className="border-b border-line-1 bg-surface-1">
      <div className="max-w-[1240px] mx-auto px-6 sm:px-10 py-24">
        <div className="max-w-2xl mb-10">
          <h2 className="font-display italic text-4xl sm:text-5xl text-ink-1 leading-[1.05]">
            Watch the whole console operate itself.
          </h2>
          <p className="mt-4 text-ink-2 text-[15px] leading-relaxed max-w-xl">
            Six scenes, one fleet. Add a server, form a mesh across three
            regions, connect a repo, ship to production, land green. Hover
            the panel to pause, click any scene to jump.
          </p>
        </div>

        <div
          ref={wrapRef}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <BrowserFrame url={current.url}>
            <ConsoleChrome activePage={current.page}>
              {/* Remount on step change so keyframes replay from 0. */}
              <div
                key={current.id}
                className={`absolute inset-0 overflow-hidden ${
                  direction === "forward"
                    ? "demo-scene-in-forward"
                    : "demo-scene-in-back"
                }`}
              >
                {current.render()}
              </div>
            </ConsoleChrome>
          </BrowserFrame>

          <StepNav
            steps={SCENES.map((s) => ({ id: s.id, label: s.label }))}
            active={step}
            onSelect={jumpTo}
            progress={progress}
          />
        </div>
      </div>
    </section>
  );
}
