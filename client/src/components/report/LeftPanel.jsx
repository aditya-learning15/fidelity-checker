import ImageComparison from './ImageComparison.jsx'

/**
 * Dark left panel — fills its allocated height, no scrolling, no card wrapper.
 *
 * Background #18181B: dark enough to absorb image letterboxing dead space,
 * not so dark it reads as "dark mode" against the white right panel.
 *
 * @param {{
 *   figmaBase64:      string,
 *   screenshotBase64: string,
 *   diffBase64:       string,
 *   issues:           Array,
 *   activeIssueIndex: number | null,
 *   onBadgeClick:     (globalIndex: number) => void,
 * }} props
 */
export default function LeftPanel({
  figmaBase64,
  screenshotBase64,
  diffBase64,
  issues,
  activeIssueIndex,
  onBadgeClick,
}) {
  return (
    <div
      className="flex-shrink-0 h-full flex flex-col"
      style={{ width: '58%', background: '#18181B' }}
    >
      <ImageComparison
        figmaBase64={figmaBase64}
        screenshotBase64={screenshotBase64}
        diffBase64={diffBase64}
        issues={issues}
        activeIssueIndex={activeIssueIndex}
        onBadgeClick={onBadgeClick}
      />
    </div>
  )
}
