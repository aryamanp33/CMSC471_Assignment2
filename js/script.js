"use strict";

// Shared definitions keep the two views tied to the same source records.
const OUTCOMES = [
  "Substantiated",
  "Unsubstantiated",
  "Exonerated",
  "Other / missing"
];

const CATEGORY_ORDER = [
  "Force",
  "Abuse of Authority",
  "Discourtesy",
  "Offensive Language"
];

const COLORS = {
  Substantiated: "#a65425",
  Unsubstantiated: "#718096",
  Exonerated: "#267c80",
  "Other / missing": "#b8a8c8"
};

const DEFINITIONS = {
  Substantiated:
    "The conduct occurred and violated department rules.",

  Unsubstantiated:
    "The investigation could not establish both that the conduct occurred and that it violated rules.",

  Exonerated:
    "The conduct occurred but did not violate department rules.",

  "Other / missing":
    "A missing or unrecognized disposition; retained separately rather than discarded."
};

const fmt = new Intl.NumberFormat("en-US");
const $ = id => document.getElementById(id);

let allRows = [];

const state = {
  category: "All categories",
  mode: "percent",
  reveal: false
};

const percent = (n, total) => total ? 100 * n / total : 0;

// --------------------------------------------------
// Data preparation and validation
// --------------------------------------------------

function normalizeDisposition(value) {
  const s = String(value ?? "").trim().toLowerCase();

  // Group disciplinary recommendations under the shared finding.
  // The word boundary prevents matching "unsubstantiated".
  if (/^substantiated(?:\b|\s*\()/.test(s)) {
    return "Substantiated";
  }

  if (s === "unsubstantiated") {
    return "Unsubstantiated";
  }

  if (s === "exonerated") {
    return "Exonerated";
  }

  return "Other / missing";
}

function prepareRows(rows) {
  return rows.map(row => ({
    category:
      String(row.fado_type ?? "").trim() || "Unknown category",

    disposition:
      normalizeDisposition(row.board_disposition),

    // Keep identifiers as strings.
    complaint:
      String(row.complaint_id ?? "").trim(),

    officer:
      String(row.unique_mos_id ?? "").trim()
  }));
}

function summarize(rows) {
  const grouped = new Map();

  rows.forEach(row => {
    if (!grouped.has(row.category)) {
      grouped.set(row.category, {
        category: row.category,
        total: 0,
        counts: Object.fromEntries(
          OUTCOMES.map(key => [key, 0])
        )
      });
    }

    const group = grouped.get(row.category);

    group.total++;
    group.counts[row.disposition]++;
  });

  const order = name =>
    CATEGORY_ORDER.includes(name)
      ? CATEGORY_ORDER.indexOf(name)
      : CATEGORY_ORDER.length;

  return [...grouped.values()].sort((a, b) =>
    order(a.category) - order(b.category) ||
    a.category.localeCompare(b.category)
  );
}

function totalsFor(rows) {
  return Object.fromEntries(
    OUTCOMES.map(key => [
      key,
      rows.filter(row => row.disposition === key).length
    ])
  );
}

function auditData(rows, groups) {
  const groupedTotal = groups.reduce(
    (sum, group) => sum + group.total,
    0
  );

  if (groupedTotal !== rows.length) {
    throw new Error(
      "Category totals do not match the included records."
    );
  }

  groups.forEach(group => {
    const outcomeTotal = OUTCOMES.reduce(
      (sum, key) => sum + group.counts[key],
      0
    );

    if (outcomeTotal !== group.total) {
      throw new Error(
        "Outcome totals do not match category totals."
      );
    }

    const percentageTotal = OUTCOMES.reduce(
      (sum, key) =>
        sum + percent(group.counts[key], group.total),
      0
    );

    if (
      group.total &&
      Math.abs(percentageTotal - 100) > 0.000001
    ) {
      throw new Error(
        "Outcome percentages do not sum to 100%."
      );
    }
  });
}

// --------------------------------------------------
// Tooltips: mouse and keyboard
// --------------------------------------------------

function tooltipLines(node, lines, event) {
  const tip = $("tooltip");
  tip.replaceChildren();

  lines.forEach((line, i) => {
    const element = document.createElement(
      i === 0 ? "strong" : "div"
    );

    element.textContent = line;
    tip.append(element);
  });

  tip.hidden = false;

  const box = node.getBoundingClientRect();

  const x =
    event && Number.isFinite(event.clientX)
      ? event.clientX
      : box.left + box.width / 2;

  const y =
    event && Number.isFinite(event.clientY)
      ? event.clientY
      : box.top;

  const width = tip.offsetWidth;
  const height = tip.offsetHeight;

  const maxLeft = Math.max(
    8,
    window.innerWidth - width - 8
  );

  tip.style.left =
    `${Math.max(8, Math.min(x + 12, maxLeft))}px`;

  tip.style.top =
    `${Math.max(
      8,
      Math.min(y + 12, window.innerHeight - height - 8)
    )}px`;
}

function hideTooltip() {
  $("tooltip").hidden = true;
}

function addInteraction(selection, linesFor) {
  selection
    .attr("tabindex", 0)
    .attr("role", "img")
    .attr("aria-label", d => linesFor(d).join(" "))

    .on("pointerenter pointermove", function(event, d) {
      tooltipLines(this, linesFor(d), event);
    })

    .on("pointerleave", hideTooltip)

    .on("focus", function(event, d) {
      tooltipLines(this, linesFor(d));
    })

    .on("blur", hideTooltip)

    .on("keydown", event => {
      if (event.key === "Escape") {
        hideTooltip();
      }
    });
}

// --------------------------------------------------
// Segment construction
// --------------------------------------------------

function segmentsFor(group, black) {
  let keys = OUTCOMES;
  const counts = {...group.counts};

  // Intentional black hat transformation.
  // The source rows and denominator do not change.
  if (black && !state.reveal) {
    counts.Cleared =
      counts.Unsubstantiated + counts.Exonerated;

    keys = [
      "Cleared",
      "Substantiated",
      "Other / missing"
    ];
  }

  let cumulative = 0;

  return keys.map(key => {
    const start = cumulative;
    cumulative += counts[key];

    return {
      key,
      count: counts[key],
      start,
      end: cumulative,
      total: group.total,
      category: group.category
    };
  });
}

// --------------------------------------------------
// SVG charts
// --------------------------------------------------

function drawChart(targetId, groups, black) {
  const root = d3.select(`#${targetId}`);
  root.selectAll("*").remove();

  const width = 940;

  const margin = {
    top: 32,
    right: 30,
    bottom: 52,
    left: 215
  };

  const rowHeight = 80;

  const height =
    margin.top +
    groups.length * rowHeight +
    margin.bottom;

  // The measurement control affects only the white hat chart.
  const countMode =
    !black && state.mode === "count";

  const max = countMode
    ? Math.max(1, d3.max(groups, d => d.total))
    : 100;

  const x = d3.scaleLinear()
    .domain([0, max])
    .range([margin.left, width - margin.right]);

  if (countMode) {
    x.nice();
  }

  const svg = root.append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "group")
    .attr(
      "aria-labelledby",
      `${targetId}-title ${targetId}-desc`
    );

  svg.append("title")
    .attr("id", `${targetId}-title`)
    .text(
      black
        ? "Black hat framing comparison"
        : "Investigation outcomes by allegation category"
    );

  svg.append("desc")
    .attr("id", `${targetId}-desc`)
    .text(
      "Stacked horizontal bars. Focus a nonempty segment for its details. Exact values are available in the data table below."
    );

  const yBottom =
    margin.top + groups.length * rowHeight;

  // Grid lines.
  svg.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(0,${yBottom})`)
    .call(
      d3.axisBottom(x)
        .ticks(5)
        .tickSize(-(yBottom - margin.top))
        .tickFormat(() => "")
    )
    .call(g => g.select(".domain").remove());

  // Shared, zero-based measurement axis.
  svg.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${yBottom})`)
    .call(
      d3.axisBottom(x)
        .ticks(5)
        .tickFormat(d =>
          countMode ? fmt.format(d) : `${d}%`
        )
    );

  svg.append("text")
    .attr("class", "axis-title")
    .attr(
      "x",
      (margin.left + width - margin.right) / 2
    )
    .attr("y", height - 8)
    .attr("text-anchor", "middle")
    .text(
      countMode
        ? "Number of allegation records"
        : "Share of allegation records within category"
    );

  groups.forEach((group, i) => {
    const y = margin.top + i * rowHeight;

    svg.append("text")
      .attr("class", "category-label")
      .attr("x", margin.left - 14)
      .attr("y", y + 21)
      .attr("text-anchor", "end")
      .text(group.category);

    svg.append("text")
      .attr("class", "sample-label")
      .attr("x", margin.left - 14)
      .attr("y", y + 42)
      .attr("text-anchor", "end")
      .text(`n = ${fmt.format(group.total)}`);

    const segments = segmentsFor(group, black)
      .filter(d => d.count > 0);

    const position = value =>
      countMode
        ? x(value)
        : x(percent(value, group.total));

    const marks = svg.append("g")
      .selectAll("rect")
      .data(segments)
      .join("rect")
      .attr("x", d => position(d.start))
      .attr("y", y + 5)
      .attr(
        "width",
        d => Math.max(
          0,
          position(d.end) - position(d.start)
        )
      )
      .attr("height", 42)
      .attr("fill", d => {
        if (d.key === "Cleared") {
          return "#71d6bb";
        }

        if (
          black &&
          !state.reveal &&
          d.key === "Substantiated"
        ) {
          return "#657084";
        }

        return COLORS[d.key];
      });

    addInteraction(marks, d => [
      `${d.category} — ${d.key}`,

      `${fmt.format(d.count)} / ${fmt.format(d.total)} allegation records (${percent(d.count, d.total).toFixed(1)}%)`,

      d.key === "Cleared"
        ? "Black hat grouping: unsubstantiated + exonerated."
        : DEFINITIONS[d.key]
    ]);

    // Avoid forcing labels into segments that are too narrow.
    // All values remain available in the tooltip and data table.
    const labeledSegments = segments.filter(d =>
      position(d.end) - position(d.start) >= 54
    );

    svg.append("g")
      .selectAll("text")
      .data(labeledSegments)
      .join("text")
      .attr("class", "segment-label")
      .attr("pointer-events", "none")
      .attr(
        "x",
        d => (position(d.start) + position(d.end)) / 2
      )
      .attr("y", y + 31)
      .attr("text-anchor", "middle")
      .attr(
        "fill",
        d => d.key === "Cleared" ? "#10372f" : "#fff"
      )
      .text(d =>
        countMode
          ? fmt.format(d.count)
          : `${percent(d.count, d.total).toFixed(1)}%`
      );
  });
}

function drawLegend(targetId, black) {
  const keys = black && !state.reveal
    ? ["Cleared", "Substantiated", "Other / missing"]
    : OUTCOMES;

  const container = $(targetId);
  container.replaceChildren();

  keys.forEach(key => {
    const item = document.createElement("span");
    const dot = document.createElement("i");

    dot.setAttribute("aria-hidden", "true");

    if (key === "Cleared") {
      dot.style.background = "#71d6bb";
    } else if (
      black &&
      !state.reveal &&
      key === "Substantiated"
    ) {
      dot.style.background = "#657084";
    } else {
      dot.style.background = COLORS[key];
    }

    item.append(
      dot,
      document.createTextNode(key)
    );

    container.append(item);
  });
}

// --------------------------------------------------
// Accessible values table
// --------------------------------------------------

function updateTable(groups) {
  const tbody = $("data-body");
  tbody.replaceChildren();

  groups.forEach(group => {
    const tr = document.createElement("tr");
    const name = document.createElement("th");

    name.scope = "row";
    name.textContent = group.category;
    tr.append(name);

    const values = [
      ...OUTCOMES.map(key =>
        `${fmt.format(group.counts[key])} (${percent(group.counts[key], group.total).toFixed(1)}%)`
      ),
      fmt.format(group.total)
    ];

    values.forEach(value => {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    });

    tbody.append(tr);
  });
}

// --------------------------------------------------
// Update all views from one selected set of rows
// --------------------------------------------------

function render() {
  hideTooltip();

  const rows = allRows.filter(row =>
    state.category === "All categories" ||
    row.category === state.category
  );

  const groups = summarize(rows);
  auditData(rows, groups);

  const totals = totalsFor(rows);

  $("record-count").textContent =
    fmt.format(rows.length);

  $("complaint-count").textContent = fmt.format(
    new Set(
      rows.map(row => row.complaint).filter(Boolean)
    ).size
  );

  $("officer-count").textContent = fmt.format(
    new Set(
      rows.map(row => row.officer).filter(Boolean)
    ).size
  );

  $("filter-note").textContent =
    `Showing ${state.category.toLowerCase()}: ${fmt.format(rows.length)} of ${fmt.format(allRows.length)} loaded allegation records. The category filter applies to both views and the table.`;

  $("white-chart-caption").textContent =
    state.mode === "percent"
      ? "Each bar totals 100%. Sample sizes differ; use the count view to compare recorded volume. Labels are rounded to one decimal."
      : "Bar lengths show allegation record counts on a shared zero-based scale.";

  // Pooled percentage: sum records first, then divide.
  const combined =
    totals.Unsubstantiated + totals.Exonerated;

  $("black-kpi").textContent =
    `${percent(combined, rows.length).toFixed(1)}%`;

  $("black-kpi-label").textContent =
    state.reveal
      ? "Unsubstantiated + exonerated allegation records"
      : "Officers cleared";

  // Avoid a literal majority claim if a selected category
  // happens to have a combined share at or below 50%.
  $("black-title").textContent =
    state.reveal
      ? "An inconclusive finding is not an officer clearance"
      : combined > rows.length / 2
        ? "Most misconduct claims end with officers cleared"
        : "Investigation outcomes point to officer clearance";

  $("black-subtitle").textContent =
    state.reveal
      ? "The same records, with their original outcome distinctions restored."
      : "A reassuring picture of investigation outcomes across misconduct categories.";

  $("black-kpi-detail").textContent =
    state.reveal
      ? `${fmt.format(combined)} of ${fmt.format(rows.length)} allegation records. This is not a percentage of officers.`
      : "A combined outcome measure across the displayed categories.";

  $("reveal-button").textContent =
    state.reveal
      ? "Restore misleading framing"
      : "Reveal the framing";

  $("reveal-button").setAttribute(
    "aria-expanded",
    String(state.reveal)
  );

  $("reveal-panel").hidden = !state.reveal;

  $("black-card").classList.toggle(
    "revealed",
    state.reveal
  );

  drawLegend("white-legend", false);
  drawLegend("black-legend", true);

  drawChart("white-chart", groups, false);
  drawChart("black-chart", groups, true);

  updateTable(groups);

  $("status").textContent =
    `Loaded ${fmt.format(allRows.length)} records`;

  $("selection-announcement").textContent =
    `${state.category}. ${fmt.format(rows.length)} allegation records. ${state.reveal ? "Framing revealed." : "Black hat framing active."}`;
}

// --------------------------------------------------
// Initialization and error handling
// --------------------------------------------------

async function init() {
  try {
    if (typeof d3 === "undefined") {
      throw new Error(
        "D3 did not load. Check your internet connection and the D3 script tag."
      );
    }

    const raw = await d3.csv("data/allegations.csv");

    const required = [
      "fado_type",
      "board_disposition",
      "complaint_id",
      "unique_mos_id"
    ];

    const missing = required.filter(
      key => !raw.columns.includes(key)
    );

    if (missing.length) {
      throw new Error(
        `Missing CSV columns: ${missing.join(", ")}`
      );
    }

    if (!raw.length) {
      throw new Error("The CSV contains no data rows.");
    }

    allRows = prepareRows(raw);

    const groups = summarize(allRows);
    auditData(allRows, groups);

    const select = $("category-filter");

    groups.forEach(group => {
      const option = document.createElement("option");

      option.value = group.category;
      option.textContent = group.category;

      select.append(option);
    });

    const other = allRows.filter(
      row => row.disposition === "Other / missing"
    ).length;

    const missingComplaint = allRows.filter(
      row => !row.complaint
    ).length;

    const missingOfficer = allRows.filter(
      row => !row.officer
    ).length;

    $("quality-note").textContent =
      `No loaded records are discarded or deduplicated. Other/missing outcomes: ${fmt.format(other)}. Missing complaint IDs: ${fmt.format(missingComplaint)}. Missing officer IDs: ${fmt.format(missingOfficer)}. Unique-ID counts omit blank IDs. Only four fields are used for these aggregate views; names are not displayed.`;

    select.addEventListener("change", () => {
      state.category = select.value;
      render();
    });

    $("view-mode").addEventListener("change", event => {
      state.mode = event.target.value;
      render();
    });

    $("reveal-button").addEventListener("click", () => {
      state.reveal = !state.reveal;
      render();
    });

    $("reset-button").addEventListener("click", () => {
      state.category = "All categories";
      state.mode = "percent";
      state.reveal = false;

      select.value = state.category;
      $("view-mode").value = state.mode;

      render();
    });

    $("controls").disabled = false;
    $("reveal-button").disabled = false;
    $("visualizations").hidden = false;

    render();
  } catch (error) {
    console.error(error);

    $("visualizations").hidden = true;
    $("status").classList.add("error");

    $("status").textContent =
      `Unable to display the charts. ${error.message} Open the page through Live Server and confirm data/allegations.csv exists.`;
  }
}

document.addEventListener("DOMContentLoaded", init);