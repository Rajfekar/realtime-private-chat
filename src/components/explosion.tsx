"use client"

import { useEffect, useMemo } from "react"

/**
 * Full-screen bomb-blast animation played when a room self-destructs.
 * Renders only on the client (mounted after a user/timer trigger), so there is
 * no SSR/hydration concern with the randomized particles.
 *
 * Sequence (~2.4s): fuse flash -> shockwave rings -> shrapnel burst + screen
 * shake -> smoke fade to black -> "ROOM DESTROYED" -> onDone() (go home).
 */
const COLORS = ["#fbbf24", "#f97316", "#ef4444", "#fde68a", "#ffffff"]
const PARTICLE_COUNT = 34
const DURATION_MS = 2400

export default function Explosion({ onDone }: { onDone: () => void }) {
  const particles = useMemo(
    () =>
      Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const angle = (360 / PARTICLE_COUNT) * i + (Math.random() * 18 - 9)
        const dist = 160 + Math.random() * 320
        const rad = (angle * Math.PI) / 180
        return {
          tx: Math.cos(rad) * dist,
          ty: Math.sin(rad) * dist,
          size: 6 + Math.random() * 14,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          delay: Math.random() * 0.12,
          dur: 0.9 + Math.random() * 0.7,
          rot: Math.random() * 720 - 360,
          round: Math.random() > 0.5,
        }
      }),
    []
  )

  const sparks = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const angle = (360 / 12) * i + Math.random() * 10
        const rad = (angle * Math.PI) / 180
        const dist = 120 + Math.random() * 260
        return { tx: Math.cos(rad) * dist, ty: Math.sin(rad) * dist, delay: Math.random() * 0.1 }
      }),
    []
  )

  useEffect(() => {
    const t = setTimeout(onDone, DURATION_MS)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div className="blast-root" role="alertdialog" aria-label="Room self-destructing">
      <div className="blast-shake">
        {/* white core flash */}
        <div className="blast-flash" />
        {/* fireball */}
        <div className="blast-fireball" />
        {/* shockwave rings */}
        <div className="blast-ring blast-ring-1" />
        <div className="blast-ring blast-ring-2" />
        <div className="blast-ring blast-ring-3" />

        {/* bomb emoji that pops */}
        <div className="blast-bomb">💥</div>

        {/* shrapnel */}
        {particles.map((p, i) => (
          <span
            key={`p-${i}`}
            className="blast-particle"
            style={
              {
                "--tx": `${p.tx}px`,
                "--ty": `${p.ty}px`,
                "--rot": `${p.rot}deg`,
                "--dur": `${p.dur}s`,
                animationDelay: `${p.delay}s`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                background: p.color,
                borderRadius: p.round ? "50%" : "2px",
                boxShadow: `0 0 8px ${p.color}`,
              } as React.CSSProperties
            }
          />
        ))}

        {/* thin sparks */}
        {sparks.map((s, i) => (
          <span
            key={`s-${i}`}
            className="blast-spark"
            style={
              {
                "--tx": `${s.tx}px`,
                "--ty": `${s.ty}px`,
                animationDelay: `${s.delay}s`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div className="blast-text">
        <p className="blast-title">ROOM DESTROYED</p>
        <p className="blast-sub">All messages permanently deleted.</p>
      </div>

      <style>{`
        .blast-root {
          position: fixed;
          inset: 0;
          z-index: 60;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background: rgba(0,0,0,0);
          animation: blastBg ${DURATION_MS}ms ease-in forwards;
        }
        .blast-shake {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          animation: blastShake 0.55s cubic-bezier(.36,.07,.19,.97) 0.05s both;
        }
        .blast-flash {
          position: absolute;
          width: 60px; height: 60px; border-radius: 50%;
          background: radial-gradient(circle, #fff 0%, #fde68a 45%, rgba(249,115,22,0) 70%);
          animation: blastFlash 0.5s ease-out forwards;
        }
        .blast-fireball {
          position: absolute;
          width: 40px; height: 40px; border-radius: 50%;
          background: radial-gradient(circle, #fff 0%, #fbbf24 30%, #f97316 55%, #ef4444 75%, rgba(239,68,68,0) 82%);
          filter: blur(1px);
          animation: blastFireball 0.9s ease-out forwards;
        }
        .blast-ring {
          position: absolute;
          border-radius: 50%;
          border: 3px solid rgba(251,191,36,0.9);
          width: 40px; height: 40px;
          opacity: 0;
        }
        .blast-ring-1 { animation: blastRing 0.9s ease-out 0.02s forwards; }
        .blast-ring-2 { animation: blastRing 1.1s ease-out 0.12s forwards; border-color: rgba(249,115,22,0.8); }
        .blast-ring-3 { animation: blastRing 1.3s ease-out 0.22s forwards; border-color: rgba(239,68,68,0.7); }
        .blast-bomb {
          position: absolute;
          font-size: 72px;
          animation: blastBomb 1.4s ease-out forwards;
          filter: drop-shadow(0 0 24px rgba(249,115,22,0.9));
        }
        .blast-particle {
          position: absolute;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          animation: blastParticle var(--dur, 1.2s) cubic-bezier(.15,.6,.3,1) forwards;
        }
        .blast-spark {
          position: absolute;
          top: 50%; left: 50%;
          width: 2px; height: 14px;
          background: linear-gradient(#fff, rgba(251,191,36,0));
          transform: translate(-50%, -50%);
          animation: blastSpark 0.8s ease-out forwards;
        }
        .blast-text {
          position: relative;
          z-index: 2;
          text-align: center;
          opacity: 0;
          animation: blastText 1s ease-out 1.35s forwards;
        }
        .blast-title {
          color: #ef4444;
          font-weight: 800;
          font-size: 1.6rem;
          letter-spacing: 0.15em;
          text-shadow: 0 0 18px rgba(239,68,68,0.8);
        }
        .blast-sub { color: #71717a; font-size: 0.8rem; margin-top: 0.4rem; }

        @keyframes blastBg {
          0% { background: rgba(0,0,0,0); }
          45% { background: rgba(0,0,0,0.2); }
          100% { background: rgba(0,0,0,1); }
        }
        @keyframes blastShake {
          10%,90% { transform: translate(-2px,1px); }
          20%,80% { transform: translate(4px,-3px); }
          30%,50%,70% { transform: translate(-8px,4px); }
          40%,60% { transform: translate(8px,-4px); }
          100% { transform: translate(0,0); }
        }
        @keyframes blastFlash {
          0% { transform: scale(0); opacity: 1; }
          60% { transform: scale(22); opacity: 0.9; }
          100% { transform: scale(30); opacity: 0; }
        }
        @keyframes blastFireball {
          0% { transform: scale(0); opacity: 1; }
          50% { transform: scale(9); opacity: 1; }
          100% { transform: scale(16); opacity: 0; }
        }
        @keyframes blastRing {
          0% { transform: scale(0.2); opacity: 0.9; border-width: 6px; }
          100% { transform: scale(26); opacity: 0; border-width: 1px; }
        }
        @keyframes blastBomb {
          0% { transform: scale(0) rotate(-20deg); opacity: 0; }
          15% { transform: scale(1.4) rotate(6deg); opacity: 1; }
          35% { transform: scale(1) rotate(0deg); opacity: 1; }
          70% { transform: scale(1.1); opacity: 1; }
          100% { transform: scale(2.4); opacity: 0; }
        }
        @keyframes blastParticle {
          0% { transform: translate(-50%,-50%) rotate(0deg); opacity: 1; }
          100% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))) rotate(var(--rot)); opacity: 0; }
        }
        @keyframes blastSpark {
          0% { transform: translate(-50%,-50%); opacity: 1; }
          100% { transform: translate(calc(-50% + var(--tx)), calc(-50% + var(--ty))); opacity: 0; }
        }
        @keyframes blastText {
          0% { opacity: 0; transform: scale(0.8); }
          100% { opacity: 1; transform: scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .blast-shake, .blast-flash, .blast-fireball, .blast-ring, .blast-bomb,
          .blast-particle, .blast-spark { animation-duration: 0.01s !important; }
        }
      `}</style>
    </div>
  )
}
