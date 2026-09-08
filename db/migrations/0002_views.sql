-- 0002_views.sql
-- The three definitions plan section 4.2 says must be written exactly, plus the portfolio
-- summary AC-6 reads.
--
-- ADR-7: PostGIS owns spatial containment, exclusively. v_hotspot_membership is the SINGLE
-- definition of which collateral belongs to which hotspot. Nothing else may decide it:
-- prep/build_hotspots.py writes polygons and radii only, and scripts/compute-reference.ts
-- reads membership from this view.

-- ADR-7: the single definition of hotspot containment.
-- The CHECK constraint makes the two cases disjoint, so this is a UNION of
-- mutually exclusive branches and can never emit a duplicate pair.
CREATE VIEW v_hotspot_membership AS
  SELECT h.id AS hotspot_id, c.id AS collateral_id
  FROM hotspots h JOIN collateral c ON ST_Intersects(c.geom, h.area)
  WHERE h.area IS NOT NULL
UNION
  SELECT h.id, c.id
  FROM hotspots h JOIN collateral c ON ST_DWithin(c.geom, h.centroid, h.radius_m)
  WHERE h.radius_m IS NOT NULL;

COMMENT ON VIEW v_hotspot_membership IS
  'ADR-7. The one containment rule. A pin inside the radius but outside the polygon, or a point on a boundary, resolves here and nowhere else, so score_inputs and the popup cannot disagree.';

-- exposure is defined ON TOP of membership, so there is one containment rule
CREATE VIEW v_hotspot_exposure AS
SELECT hotspot_id, loan_exposure_sgd,
       loan_exposure_sgd / NULLIF(SUM(loan_exposure_sgd) OVER (), 0) AS exposure_share
FROM (
  SELECT h.id AS hotspot_id, COALESCE(SUM(la.requested_amount), 0) AS loan_exposure_sgd
  FROM hotspots h
  LEFT JOIN v_hotspot_membership m ON m.hotspot_id = h.id
  LEFT JOIN loan_applications la ON la.collateral_id = m.collateral_id
  GROUP BY h.id
) e;

COMMENT ON VIEW v_hotspot_exposure IS
  'ADR-7. hotspots carries no loan_exposure_sgd and no exposure_share column; both live here, with one writer and two readers: the popup reads this view live, the prompt reads a snapshot taken into score_inputs at prep:reference time. Rerun prep:reference after any change to the portfolio or to loan amounts. Collateral inside two hotspots is counted in both, so the hotspot exposures sum to MORE than the portfolio total and each share understates that hotspot true fraction of the book; docs/sources.md states this.';

-- AC-6. Grouped by (scenario, country) because PostgreSQL has no parameterised view.
-- Returns three of the four headline figures. The fourth, the top-10 exposed cases, is a
-- separate ordered query in lib/db/queries.ts, not part of this view.
--
-- The two aggregates are computed separately and joined, so the collateral value sums cannot
-- be multiplied by the application join.
CREATE VIEW v_portfolio_summary AS
WITH val AS (
  SELECT v.scenario,
         c.country,
         COUNT(*)                        AS collateral_count,
         SUM(c.appraised_value_sgd)      AS collateral_value_sgd,
         COALESCE(SUM(c.appraised_value_sgd) FILTER (WHERE v.band <> 'green'), 0)
                                         AS value_amber_or_worse_sgd,
         COALESCE(SUM(c.appraised_value_sgd) FILTER (WHERE v.band <> 'green'), 0)
           / NULLIF(SUM(c.appraised_value_sgd), 0)
                                         AS share_amber_or_worse,
         SUM(c.appraised_value_sgd - v.adjusted_value_sgd)
                                         AS total_haircut_sgd
  FROM valuations v
  JOIN collateral c ON c.id = v.collateral_id
  JOIN rule_sets rs ON rs.id = v.rule_set_id AND rs.is_active
  GROUP BY v.scenario, c.country
),
rev AS (
  -- revalue_by_year is a property of the APPLICATION and is stored identically on all three
  -- recommendations rows, so this must be COUNT(DISTINCT ...) or the figure trebles. The tile
  -- is labelled scenario-invariant on screen so it does not read as frozen when the slider moves.
  SELECT r.scenario,
         c.country,
         COUNT(DISTINCT r.loan_application_id) FILTER (WHERE r.revalue_by_year <= 2030)
           AS revalue_by_2030_count
  FROM recommendations r
  JOIN loan_applications la ON la.id = r.loan_application_id
  JOIN collateral c ON c.id = la.collateral_id
  JOIN rule_sets rs ON rs.id = r.rule_set_id AND rs.is_active
  GROUP BY r.scenario, c.country
)
SELECT val.scenario,
       val.country,
       val.collateral_count,
       val.collateral_value_sgd,
       val.value_amber_or_worse_sgd,
       val.share_amber_or_worse,
       val.total_haircut_sgd,
       COALESCE(rev.revalue_by_2030_count, 0) AS revalue_by_2030_count
FROM val
LEFT JOIN rev ON rev.scenario = val.scenario AND rev.country = val.country;

COMMENT ON VIEW v_portfolio_summary IS
  'AC-6, three of the four headline figures, over the ACTIVE rule set only. Sum value_amber_or_worse_sgd and collateral_value_sgd across countries to get the portfolio share; never average share_amber_or_worse. The top-10 exposed cases is a separate ordered query.';
