"use client"

import { useEffect, useMemo } from "react"

/**
 * "Clean sweep" animation for the always-on room clear (the counterpart to the
 * bomb blast, but non-destructive — the room stays). A broom sweeps across, a
 * light wipe passes over the screen, and a few sparkles trail behind.
 */
const DURATION_MS = 1300

export default function SweepClean({ onDone }: { onDone: () => void }) {
  const sparkles = useMemo(
    () =>
      Array.from({ length: 10 }, () => ({
        top: 30 + Math.random() * 40, // vh
        delay: Math.random() * 0.6,
        size: 10 + Math.random() * 14,
      })),
    []
  )

  useEffect(() => {
    const t = setTimeout(onDone, DURATION_MS)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className="sweep-root" role="status" aria-label="Clearing chat">
      <div className="sweep-wipe" />
      <div className="sweep-broom">🧹</div>
      {sparkles.map((s, i) => (
        <span
          key={i}
          className="sweep-spark"
          style={{
            top: `${s.top}vh`,
            fontSize: `${s.size}px`,
            animationDelay: `${s.delay}s`,
          }}
        >
          ✨
        </span>
      ))}
      <div className="sweep-text">CHAT CLEARED</div>

      <style>{`
        .sweep-root {
          position: fixed;
          inset: 0;
          z-index: 60;
          overflow: hidden;
          pointer-events: none;
          animation: sweepDim ${DURATION_MS}ms ease-in-out forwards;
        }
        /* diagonal light wipe travelling left -> right */
        .sweep-wipe {
          position: absolute;
          top: 0; left: -40%;
          width: 40%; height: 100%;
          background: linear-gradient(
            100deg,
            rgba(16,185,129,0) 0%,
            rgba(16,185,129,0.10) 40%,
            rgba(255,255,255,0.35) 50%,
            rgba(16,185,129,0.10) 60%,
            rgba(16,185,129,0) 100%
          );
          filter: blur(2px);
          animation: sweepWipe 1.1s cubic-bezier(.4,0,.2,1) forwards;
        }
        .sweep-broom {
          position: absolute;
          top: 44vh;
          left: -10%;
          font-size: 64px;
          filter: drop-shadow(0 0 16px rgba(16,185,129,0.6));
          animation: sweepBroom 1.1s cubic-bezier(.4,0,.2,1) forwards;
        }
        .sweep-spark {
          position: absolute;
          left: 50%;
          opacity: 0;
          animation: sweepSpark 0.9s ease-out forwards;
        }
        .sweep-text {
          position: absolute;
          top: 54vh;
          width: 100%;
          text-align: center;
          color: #34d399;
          font-weight: 800;
          letter-spacing: 0.2em;
          font-size: 1.1rem;
          text-shadow: 0 0 16px rgba(16,185,129,0.7);
          opacity: 0;
          animation: sweepText 1.2s ease-out forwards;
        }
        @keyframes sweepDim {
          0% { background: rgba(0,0,0,0); }
          35% { background: rgba(0,0,0,0.45); }
          100% { background: rgba(0,0,0,0); }
        }
        @keyframes sweepWipe {
          0% { left: -40%; }
          100% { left: 100%; }
        }
        @keyframes sweepBroom {
          0% { left: -10%; transform: rotate(-12deg); }
          50% { transform: rotate(10deg); }
          100% { left: 105%; transform: rotate(-12deg); }
        }
        @keyframes sweepSpark {
          0% { transform: translateY(0) scale(0.6); opacity: 0; }
          40% { opacity: 1; }
          100% { transform: translateY(28px) scale(1); opacity: 0; }
        }
        @keyframes sweepText {
          0%, 30% { opacity: 0; transform: scale(0.9); }
          55% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sweep-wipe, .sweep-broom, .sweep-spark { animation-duration: 0.01s !important; }
        }
      `}</style>
    </div>
  )
}
