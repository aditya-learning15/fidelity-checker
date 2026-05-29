import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import apiClient from '../lib/apiClient'

export default function FeedbackPage() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiClient.get('/api/analyze/feedback/summary')
      .then(res => {
        setData(res.data)
        setLoading(false)
      })
      .catch(e => {
        setError(e.message)
        setLoading(false)
      })
  }, [])

  if (loading) return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '60vh',
      color: 'var(--color-text-secondary)',
      fontSize: 13
    }}>
      Loading feedback data...
    </div>
  )

  if (error) return (
    <div style={{
      maxWidth: 720,
      margin: '40px auto',
      padding: '0 16px',
      color: 'var(--color-text-secondary)',
      fontSize: 13
    }}>
      Could not load feedback: {error}
    </div>
  )

  const feedbackTypeColor = (type) =>
    type === 'incorrect'
      ? { bg: '#FAEEDA', color: '#633806' }
      : { bg: '#F1EFE8', color: '#444441' }

  return (
    <div style={{
      maxWidth: 760,
      margin: '0 auto',
      padding: '24px 16px 48px'
    }}>

      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 28
      }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 13,
            color: 'var(--color-text-secondary)',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: 0
          }}
        >
          <svg
            style={{ fontSize: 14, width: 14, height: 14 }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <span style={{
          fontSize: 16,
          fontWeight: 500,
          color: 'var(--color-text-primary)'
        }}>
          Feedback and learning
        </span>
      </div>

      {/* Summary stat cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 10,
        marginBottom: 28
      }}>
        {[
          {
            label: 'Total feedback',
            value: data.totalEntries
          },
          {
            label: 'Flagged incorrect',
            value: data.incorrectFlags
          },
          {
            label: 'Accepted deviations',
            value: data.acceptedDeviations
          },
          {
            label: 'Active suppressions',
            value: data.suppressionPatterns
              .filter(p => p.isActive).length
          }
        ].map(({ label, value }) => (
          <div
            key={label}
            style={{
              background: 'var(--color-background-secondary)',
              borderRadius: 'var(--border-radius-md)',
              padding: '12px 14px'
            }}
          >
            <div style={{
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              marginBottom: 6
            }}>
              {label}
            </div>
            <div style={{
              fontSize: 22,
              fontWeight: 500,
              color: 'var(--color-text-primary)'
            }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Active suppressions */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          marginBottom: 4
        }}>
          Suppressed patterns
        </div>
        <div style={{
          fontSize: 11,
          color: 'var(--color-text-secondary)',
          marginBottom: 12
        }}>
          Flagged incorrect 2+ times — no longer shown in reports
        </div>

        {data.suppressionPatterns.filter(p => p.isActive).length === 0
          ? (
            <div style={{
              padding: '16px',
              background: 'var(--color-background-secondary)',
              borderRadius: 'var(--border-radius-md)',
              fontSize: 12,
              color: 'var(--color-text-secondary)'
            }}>
              No patterns suppressed yet. Flag incorrect
              observations in reports to build this list.
            </div>
          )
          : (
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12
            }}>
              <thead>
                <tr style={{
                  borderBottom: '0.5px solid var(--color-border-tertiary)'
                }}>
                  {['Element', 'Property',
                    'Times flagged', 'Status'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left',
                      padding: '6px 8px',
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--color-text-secondary)'
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.suppressionPatterns
                  .filter(p => p.isActive)
                  .map((p, i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom:
                        '0.5px solid var(--color-border-tertiary)'
                    }}
                  >
                    <td style={{ padding: '8px 8px' }}>
                      {p.referencedElement ?? '—'}
                    </td>
                    <td style={{
                      padding: '8px 8px',
                      color: 'var(--color-text-secondary)'
                    }}>
                      {p.property ?? '—'}
                    </td>
                    <td style={{ padding: '8px 8px' }}>
                      {p.count}
                    </td>
                    <td style={{ padding: '8px 8px' }}>
                      <span style={{
                        fontSize: 10,
                        padding: '2px 8px',
                        borderRadius: 20,
                        background: '#EAF3DE',
                        color: '#27500A',
                        fontWeight: 500
                      }}>
                        Active
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>

      {/* Accepted deviations */}
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          marginBottom: 4
        }}>
          Accepted deviations
        </div>
        <div style={{
          fontSize: 11,
          color: 'var(--color-text-secondary)',
          marginBottom: 12
        }}>
          Known differences — shown at reduced severity
        </div>

        {data.acceptedPatterns.length === 0
          ? (
            <div style={{
              padding: '16px',
              background: 'var(--color-background-secondary)',
              borderRadius: 'var(--border-radius-md)',
              fontSize: 12,
              color: 'var(--color-text-secondary)'
            }}>
              No accepted deviations yet.
            </div>
          )
          : (
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12
            }}>
              <thead>
                <tr style={{
                  borderBottom:
                    '0.5px solid var(--color-border-tertiary)'
                }}>
                  {['Element', 'Property',
                    'Times accepted'].map(h => (
                    <th key={h} style={{
                      textAlign: 'left',
                      padding: '6px 8px',
                      fontSize: 11,
                      fontWeight: 500,
                      color: 'var(--color-text-secondary)'
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.acceptedPatterns.map((p, i) => (
                  <tr
                    key={i}
                    style={{
                      borderBottom:
                        '0.5px solid var(--color-border-tertiary)'
                    }}
                  >
                    <td style={{ padding: '8px 8px' }}>
                      {p.referencedElement ?? '—'}
                    </td>
                    <td style={{
                      padding: '8px 8px',
                      color: 'var(--color-text-secondary)'
                    }}>
                      {p.property ?? '—'}
                    </td>
                    <td style={{ padding: '8px 8px' }}>
                      {p.count}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>

      {/* Recent feedback */}
      <div>
        <div style={{
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          marginBottom: 12
        }}>
          Recent feedback
        </div>

        {data.recentEntries.length === 0
          ? (
            <div style={{
              padding: '16px',
              background: 'var(--color-background-secondary)',
              borderRadius: 'var(--border-radius-md)',
              fontSize: 12,
              color: 'var(--color-text-secondary)'
            }}>
              No feedback submitted yet.
            </div>
          )
          : data.recentEntries.map((entry, i) => {
            const pill = feedbackTypeColor(entry.feedbackType)
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 0',
                  borderBottom:
                    '0.5px solid var(--color-border-tertiary)',
                  fontSize: 12
                }}
              >
                <span style={{
                  fontSize: 11,
                  color: 'var(--color-text-secondary)',
                  flexShrink: 0,
                  minWidth: 64
                }}>
                  {new Date(entry.timestamp)
                    .toLocaleDateString('en-GB', {
                      day: 'numeric',
                      month: 'short'
                    })}
                </span>
                <span style={{
                  fontSize: 10,
                  padding: '2px 7px',
                  borderRadius: 20,
                  background: pill.bg,
                  color: pill.color,
                  fontWeight: 500,
                  flexShrink: 0
                }}>
                  {entry.feedbackType === 'incorrect'
                    ? 'Flagged incorrect'
                    : 'Accepted'}
                </span>
                <span style={{
                  color: 'var(--color-text-primary)',
                  flex: 1
                }}>
                  {entry.referencedElement ?? '—'}
                  {entry.property && (
                    <span style={{
                      color: 'var(--color-text-secondary)',
                      marginLeft: 4
                    }}>
                      · {entry.property}
                    </span>
                  )}
                </span>
                <span style={{
                  fontSize: 10,
                  padding: '2px 7px',
                  borderRadius: 20,
                  background: 'var(--color-background-secondary)',
                  color: 'var(--color-text-secondary)',
                  flexShrink: 0
                }}>
                  {entry.issueCategory ?? '—'}
                </span>
              </div>
            )
          })
        }
      </div>

    </div>
  )
}
