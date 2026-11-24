(() => {
  const vscode = acquireVsCodeApi();
  const byId = id => document.getElementById(id);
  let candidates = [];
  let selected = new Set();
  let trials = [];
  let evaluationSummary = null;
  let running = false;
  let preselectionApplied = false;
  let coverageFilter = 'incomplete';

  function candidateKey(candidate) {
    return `${candidate.vendor}\u0000${candidate.id}`;
  }

  function setStatus(message) {
    byId('evaluation-status-line').textContent = message;
  }

  function priceLabel(model) {
    if (model.pricing?.budgetClass === 'unpriced' || model.pricing?.source === 'unpriced') return 'Unknown';
    if (model.pricing?.source === 'manual' && model.pricing?.budgetClass) return String(model.pricing.budgetClass);
    if (model.pricing?.category) return String(model.pricing.category);
    if (Number.isFinite(model.pricing?.inputCost) || Number.isFinite(model.pricing?.outputCost)) {
      return `${Number.isFinite(model.pricing.inputCost) ? model.pricing.inputCost : 0} in / ${Number.isFinite(model.pricing.outputCost) ? model.pricing.outputCost : 0} out`;
    }
    return 'Unknown';
  }

  function isRejected(model) {
    return Boolean(model.rejected || model.rejection);
  }

  function matchesCoverageFilter(model) {
    if (coverageFilter === 'rejected') return isRejected(model);
    if (isRejected(model)) return false;
    if (coverageFilter === 'never') return model.coverageStatus === 'never_evaluated';
    if (coverageFilter === 'incomplete') return model.coverageStatus === 'never_evaluated'
      || model.coverageStatus === 'control_passed'
      || model.coverageStatus === 'control_blocked'
      || model.coverageStatus === 'strict_blocked';
    if (coverageFilter === 'evaluated') return model.coverageStatus !== 'never_evaluated';
    if (coverageFilter === 'control') return model.coverageStatus === 'control_passed' || model.coverageStatus === 'control_blocked';
    if (coverageFilter === 'strict') return model.coverageStatus === 'strict_completed' || model.coverageStatus === 'strict_blocked';
    return true;
  }

  function matchesCoverageSelection(model) {
    if (coverageFilter === 'rejected') return false;
    if (isRejected(model)) return false;
    if (coverageFilter === 'all') return true;
    if (coverageFilter === 'incomplete') return model.coverageStatus !== 'strict_completed';
    return matchesCoverageFilter(model);
  }

  function coverageLabel(status) {
    if (status === 'never_evaluated') return 'Never evaluated';
    if (status === 'control_passed') return 'Control passed';
    if (status === 'control_blocked') return 'Control blocked';
    if (status === 'strict_completed') return 'Strict completed';
    if (status === 'strict_blocked') return 'Strict blocked';
    return 'Never evaluated';
  }

  function renderCandidates() {
    const list = byId('candidate-list');
    list.replaceChildren();
    const visible = candidates.filter(matchesCoverageFilter);
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'candidate-empty';
      empty.textContent = 'No models match this coverage filter.';
      list.append(empty);
      updateResultCount();
      return;
    }
    if (!candidates.length) {
      const empty = document.createElement('p');
      empty.className = 'candidate-empty';
      empty.textContent = 'No models are available under the effective provider policy.';
      list.append(empty);
      updateResultCount();
      return;
    }
    for (const model of visible) {
      const key = candidateKey(model);
      const label = document.createElement('label');
      label.className = 'candidate-item';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.has(key);
      checkbox.disabled = isRejected(model);
      checkbox.setAttribute('aria-label', `Evaluate ${model.name || model.id}`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(key); else selected.delete(key);
        updateResultCount();
      });
      const details = document.createElement('span');
      details.className = 'candidate-details';
      const title = document.createElement('strong');
      title.textContent = model.name || model.id;
      const identity = document.createElement('span');
      identity.textContent = `Provider: ${model.vendor || 'unknown'} | Model: ${model.id}`;
      const metadata = document.createElement('span');
      metadata.textContent = `Family: ${model.family || 'Unknown'} | Version: ${model.version || 'Unknown'} | Capability tier: ${model.capabilityTier || 'unrated'} | Evidence: ${model.evidenceStatus || 'unknown'} (${model.evidenceSourceCount || 0} sources) | Price: ${priceLabel(model)}`;
      const badge = document.createElement('span');
      badge.className = `coverage-badge coverage-${model.coverageStatus || 'never_evaluated'}`;
      badge.textContent = coverageLabel(model.coverageStatus);
      if (model.lastEvaluatedAt) badge.title = `Last evaluated: ${model.lastEvaluatedAt}`;
      details.append(title, identity, metadata, badge);
      if (isRejected(model)) {
        const rejectionBadge = document.createElement('span');
        rejectionBadge.className = 'rejection-badge';
        rejectionBadge.textContent = 'Rejected';
        const reset = document.createElement('button');
        reset.type = 'button';
        reset.textContent = 'Reset rejection';
        reset.addEventListener('click', event => {
          event.preventDefault();
          vscode.postMessage({ type: 'clearCandidateRejection', candidate: { vendor: model.vendor, id: model.id } });
        });
        details.append(rejectionBadge, reset);
      } else {
        const reject = document.createElement('button');
        reject.type = 'button';
        reject.textContent = 'Reject candidate';
        reject.addEventListener('click', event => {
          event.preventDefault();
          vscode.postMessage({ type: 'rejectCandidate', candidate: { vendor: model.vendor, id: model.id } });
        });
        details.append(reject);
      }
      label.append(checkbox, details);
      list.append(label);
    }
    updateResultCount();
  }

  function updateResultCount() {
    const count = selected.size;
    byId('result-count').textContent = `${count} selected / ${count * 3} operations`;
  }

  function displayName(trial) {
    const requested = trial.requested || {};
    return `${requested.vendor || 'unknown'} / ${requested.id || 'unknown'}`;
  }

  function renderSummary() {
    const coverageContainer = byId('coverage-summary');
    coverageContainer.replaceChildren();
    const neverCount = candidates.filter(model => model.coverageStatus === 'never_evaluated').length;
    const controlCount = candidates.filter(model => model.coverageStatus === 'control_passed' || model.coverageStatus === 'control_blocked').length;
    const strictCount = candidates.filter(model => model.coverageStatus === 'strict_completed' || model.coverageStatus === 'strict_blocked').length;
    const classCount = (name) => trials.filter(trial => trial.failureClass === name).length;
    coverageContainer.textContent = `Never evaluated: ${neverCount} | Control only: ${controlCount} | Strict evaluated: ${strictCount} | Rejected technical configuration: ${classCount('rejected_technical_configuration')} | Incompatible provider boundary: ${classCount('incompatible_provider_boundary')} | Incorrect answer rubric: ${classCount('incorrect_answer_rubric')} | Correct answer: ${classCount('correct_answer')}`;

    const container = byId('evaluation-summary');
    container.replaceChildren();
    byId('evaluation-verdict').textContent = evaluationSummary?.verdict || 'Mixed';
    const summary = evaluationSummary;
    if (!summary || !summary.providers?.length) {
      const empty = document.createElement('p');
      empty.className = 'candidate-empty';
      empty.textContent = 'No provider results yet.';
      container.append(empty);
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'provider-summary-grid';
    for (const provider of summary.providers) {
      const item = document.createElement('div');
      item.className = 'provider-summary';
      const title = document.createElement('strong');
      title.textContent = provider.provider;
      const details = document.createElement('span');
      details.textContent = `${provider.candidates} candidates | Control pass ${provider.controlPass} / fail ${provider.controlFail} / block ${provider.controlBlock} | Strict completed ${provider.strictCompleted} / blocked ${provider.strictBlocked}`;
      item.append(title, details);
      grid.append(item);
    }
    container.append(grid);
  }

  function appendTrialRow(tableBody, trial) {
    const controlStatus = trial.status === 'control_block' || trial.status === 'control_mismatch';
    const blockedStatus = trial.status === 'blocked' || controlStatus;
    const row = document.createElement('tr');
    row.className = trial.status === 'blocked' ? 'trial-blocked' : 'trial-completed';
    if (controlStatus) row.className = 'trial-blocked';
    const resolved = trial.resolvedIdentity;
    const resolvedText = resolved ? `${resolved.vendor || 'unknown'} / ${resolved.id || 'unknown'}` : 'Not resolved';
    const reason = blockedStatus ? `${trial.blockedType || 'blocked'}: ${trial.error || trial.reason || 'Unknown error'}` : trial.reason || trial.evidenceCode || 'Completed';
    const syntheticSkip = trial.strictSkipped === true || trial.status === 'strict_skipped';
    const statusText = syntheticSkip
      ? 'Skipped'
      : trial.status === 'control_block'
        ? 'Control blocked'
        : trial.status === 'control_mismatch'
          ? 'Control mismatch'
          : String(trial.status || 'unknown');
    const failureClassText = syntheticSkip
      ? 'Not applicable'
      : trial.failureClass === 'rejected'
        ? 'Rejected'
        : String(trial.failureClass || '-');
    const cells = [
      displayName(trial),
      String(trial.trial || ''),
      statusText,
      String(trial.phase || trial.statusPhase || '-'),
      String(trial.outcome || (blockedStatus ? 'blocked' : '')),
      failureClassText,
      Number.isFinite(trial.durationMs) ? `${Math.round(trial.durationMs)} ms` : '-',
      resolvedText,
      reason
    ];
    for (const text of cells) {
      const cell = document.createElement('td');
      cell.textContent = text;
      row.append(cell);
    }
    tableBody.append(row);
  }

  function renderResults() {
    const container = byId('evaluation-results');
    container.replaceChildren();
    if (!trials.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No trials yet. Select candidates and run the evaluation.';
      container.append(empty);
      return;
    }

    const candidateGroups = new Map();
    for (const candidate of candidates) {
      const key = candidateKey(candidate);
      if (!candidateGroups.has(key)) candidateGroups.set(key, { candidate, rows: [] });
    }

    const orderedTrials = trials.slice().reverse();
    for (const trial of orderedTrials) {
      const requested = trial.requested || {};
      const key = candidateKey({ vendor: requested.vendor || 'unknown', id: requested.id || 'unknown' });
      if (!candidateGroups.has(key)) {
        candidateGroups.set(key, {
          candidate: { vendor: requested.vendor || 'unknown', id: requested.id || 'unknown', name: requested.id || 'unknown' },
          rows: []
        });
      }
      candidateGroups.get(key).rows.push(trial);
    }

    for (const group of candidateGroups.values()) {
      const candidate = group.candidate;
      const rows = group.rows;
      if (!rows.length && !isRejected(candidate)) continue;

      const section = document.createElement('details');
      section.className = 'evaluation-result-group';
      section.open = rows.length > 0;
      const summary = document.createElement('summary');
      const disposition = isRejected(candidate)
        ? 'Rejected'
        : coverageLabel(candidate.coverageStatus);
      summary.textContent = `${candidate.name || candidate.id} | ${candidate.vendor || 'unknown'} / ${candidate.id} | ${disposition} | ${rows.length} row${rows.length === 1 ? '' : 's'}`;
      section.append(summary);

      const wrap = document.createElement('div');
      wrap.className = 'table-wrap evaluation-result-table';
      const table = document.createElement('table');
      table.innerHTML = '<thead><tr><th>Requested model</th><th>Trial</th><th>Status</th><th>Phase</th><th>Outcome</th><th>Failure class</th><th>Duration</th><th>Resolved identity</th><th>Reason/error</th></tr></thead><tbody></tbody>';
      const body = table.querySelector('tbody');
      for (const trial of rows) appendTrialRow(body, trial);
      wrap.append(table);
      section.append(wrap);
      container.append(section);
    }
  }

  function setRunning(value) {
    running = value;
    byId('run-evaluation').disabled = value;
    byId('cancel-evaluation').disabled = !value;
  }

  byId('refresh-evaluation').addEventListener('click', () => vscode.postMessage({ type: 'refreshModelEvaluation' }));
  byId('select-all-candidates').addEventListener('click', () => {
    for (const model of candidates.filter(matchesCoverageSelection)) selected.add(candidateKey(model));
    renderCandidates();
  });
  byId('clear-candidates').addEventListener('click', () => {
    selected.clear();
    renderCandidates();
  });
  byId('coverage-filter').addEventListener('change', event => {
    coverageFilter = event.target.value;
    selected = new Set(candidates.filter(matchesCoverageSelection).map(candidateKey));
    renderCandidates();
  });
  byId('run-evaluation').addEventListener('click', () => {
    const chosen = candidates
      .filter(model => selected.has(candidateKey(model)))
      .map(model => ({ id: model.id, vendor: model.vendor }));
    if (!chosen.length) {
      byId('progress-status').textContent = 'Select at least one model, then run the evaluation.';
      return;
    }
    vscode.postMessage({ type: 'runModelEvaluation', candidates: chosen });
  });
  byId('cancel-evaluation').addEventListener('click', () => {
    byId('cancel-evaluation').disabled = true;
    vscode.postMessage({ type: 'cancelModelEvaluation' });
  });

  window.addEventListener('message', event => {
    const message = event.data;
    if (message.type === 'modelEvaluationLoading') {
      setStatus('Loading effective model inventory...');
    } else if (message.type === 'preselectCandidates') {
      selected = new Set(message.candidates.map(candidateKey));
      preselectionApplied = true;
      renderCandidates();
    } else if (message.type === 'modelEvaluation') {
      candidates = Array.isArray(message.candidates) ? message.candidates : [];
      trials = Array.isArray(message.evaluation?.trials) ? message.evaluation.trials : [];
      evaluationSummary = message.evaluationSummary || null;
      if (!preselectionApplied) {
        coverageFilter = 'incomplete';
        selected = new Set(candidates.filter(matchesCoverageSelection).map(candidateKey));
        byId('coverage-filter').value = coverageFilter;
      }
      preselectionApplied = true;
      setStatus(message.error ? `Inventory unavailable: ${message.error}` : `${candidates.length} eligible candidate model(s) under effective provider policy.`);
      renderCandidates();
      renderSummary();
      renderResults();
    } else if (message.type === 'modelEvaluationStatus') {
      setRunning(Boolean(message.running));
      byId('progress-status').textContent = message.message || (message.running ? 'Running...' : 'Ready.');
      if (Number.isFinite(message.completed) && Number.isFinite(message.total) && message.total > 0) {
        byId('evaluation-progress').value = Math.min(100, Math.round((message.completed / message.total) * 100));
      }
      if (message.trial) {
        const requested = message.trial.requested || {};
        const liveCandidateKey = candidateKey({ vendor: requested.vendor || 'unknown', id: requested.id || 'unknown' });
        const match = trials.findIndex(trial => {
          const existingRequested = trial.requested || {};
          return candidateKey({ vendor: existingRequested.vendor || 'unknown', id: existingRequested.id || 'unknown' }) === liveCandidateKey
            && trial.pairId === message.trial.pairId
            && trial.trial === message.trial.trial;
        });
        if (match >= 0) trials[match] = message.trial; else trials.push(message.trial);
        renderResults();
      }
      if (!message.running) {
        byId('evaluation-status-line').textContent = message.cancelled ? 'Evaluation cancelled.' : 'Evaluation finished.';
      }
    }
  });

  setRunning(false);
  vscode.postMessage({ type: 'ready' });
})();
