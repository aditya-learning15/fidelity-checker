import { useState, useEffect } from 'react'

export default function MobileNudge() {
  const [isMobile, setIsMobile] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  if (!isMobile || dismissed) return null

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'var(--color-background-primary)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px'
    }}>
      <div style={{
        maxWidth: 360,
        textAlign: 'center'
      }}>
        <svg
          className="ti ti-device-laptop"
          aria-hidden="true"
          style={{
            fontSize: 48,
            color: 'var(--color-text-secondary)',
            display: 'block',
            marginBottom: 16,
            width: 48,
            height: 48,
            margin: '0 auto 16px'
          }}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
          <path d="M2 17h20" />
        </svg>
        <p style={{
          fontSize: 16,
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          margin: '0 0 8px'
        }}>
          Fidelity Checker works best on desktop
        </p>
        <p style={{
          fontSize: 13,
          color: 'var(--color-text-secondary)',
          lineHeight: 1.5,
          margin: '0 0 24px'
        }}>
          This tool is designed for design and development
          workflows on a laptop or desktop screen.
          Open it on a larger screen for the full experience.
        </p>
        <button
          onClick={() => setDismissed(true)}
          style={{
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            background: 'none',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: 'var(--border-radius-md)',
            padding: '6px 16px',
            cursor: 'pointer'
          }}
        >
          Continue anyway
        </button>
      </div>
    </div>
  )
}
