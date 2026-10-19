// An opened evidence bundle (REL-01): what the API checked, and the comparison of each recorded
// run with the same layout run again here, with the bundle's own process and seed.
import type { EvidenceBundleOpened } from "@replay-world/contracts";
import type { Reproduction } from "../run/evidence";

interface Props {
  filename: string;
  bundle: EvidenceBundleOpened;
  check: Reproduction | null;
  onRerun: () => void;
}

/** Long values (route reasons, the explanation) in full on hover; shortened in the table. */
const short = (text: string) => (text.length > 90 ? `${text.slice(0, 88)}…` : text);

export function BundleCheck({ filename, bundle, check, onRerun }: Props) {
  const m = bundle.manifest;
  return (
    <div className="bundle-check" data-testid="bundle-check" data-same={check ? String(check.same) : ""}>
      <h4>Evidence bundle</h4>
      <p className="small">
        Opened from <strong>{filename}</strong>, made {m.created_utc} with engine {m.engine}: {bundle.verified.length} files checked against its manifest (sha256).
        {m.project.synthetic && (
          <>
            {" "}
            <span className="badge badge-example">Synthetic example</span>
          </>
        )}
      </p>
      {bundle.stored.length > 0 && <p className="small muted">Stored from the bundle: {bundle.stored.join("; ")}.</p>}
      {bundle.problems.map((p) => (
        <p key={p} className="small status-warn">
          {p}
        </p>
      ))}
      {!check && (
        <button type="button" className="button button-primary" data-testid="bundle-rerun" onClick={onRerun}>
          Run both layouts again
        </button>
      )}
      {check && (
        <>
          <p className={`small ${check.same ? "status-ok" : "status-error"}`} data-testid="bundle-verdict">
            {check.same
              ? "Reproduced: every recorded run gives the same events, in the same order, with the same fingerprints, counts, blocked routes and explanation."
              : "Not reproduced: the rows marked ✗ differ from what the bundle recorded."}
          </p>
          <div className="table-scroll">
            <table className="run-table bundle-table" data-testid="bundle-rows">
              <thead>
                <tr>
                  <th>Layout</th>
                  <th>Compared</th>
                  <th>Recorded and now</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {check.rows.map((r) => {
                  const full = r.same ? r.recorded : `recorded ${r.recorded} · now ${r.now}`;
                  return (
                    <tr key={`${r.layout}-${r.what}`} className={r.same ? "" : "worse"} data-same={String(r.same)}>
                      <td>{r.layout}</td>
                      <td>{r.what}</td>
                      <td className="bundle-value" title={full}>
                        {short(full)}
                      </td>
                      <td>{r.same ? "✓ same" : "✗ differs"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
