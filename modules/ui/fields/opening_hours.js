import { dispatch as d3_dispatch } from 'd3-dispatch';
import { select as d3_select } from 'd3-selection';

import { t } from '../../core/localizer';
import { utilGetSetValue, utilNoAuto, utilRebind } from '../../util';


/**
 * uiFieldOpeningHours
 *
 * A visual weekly-calendar widget for the `opening_hours` (and similar
 * "schedule") OSM tags.  It renders a vertical list of weekday rows where
 * the user can:
 *   • enable/disable the day with a checkbox
 *   • set a start-time and an end-time
 *   • see a "(Next Day)" label when the shift crosses midnight
 *
 * A header button lets the mapper toggle between the visual view and a
 * plain <input type="text"> fallback for complex expressions.
 *
 * DOM contract (follows input.js / access.js conventions):
 *   selection              – the .form-field-input-wrap div managed by field.js
 *   .oh-widget             – root container for the whole widget
 *   .oh-toggle-bar         – strip with the "Switch to Text View" button
 *   .oh-visual-view        – the weekly list (hidden when text mode is active)
 *   .oh-text-view          – the raw <input> (hidden when visual mode is active)
 *   ul.oh-days             – list of day rows
 *   li.oh-day-row          – one row per weekday
 */
export function uiFieldOpeningHours(field, context) {

    // ── state ──────────────────────────────────────────────────────────────
    var dispatch  = d3_dispatch('change');
    var _tags;
    var _visualMode = true;   // start in visual mode
    var _hasConditional = false;

    // The seven ISO weekday abbreviations used by the opening_hours spec.
    var DAYS = [
        { key: 'Mo', label: 'Mo' },
        { key: 'Tu', label: 'Tu' },
        { key: 'We', label: 'We' },
        { key: 'Th', label: 'Th' },
        { key: 'Fr', label: 'Fr' },
        { key: 'Sa', label: 'Sa' },
        { key: 'Su', label: 'Su' }
    ];

    // Per-day model; each entry mirrors a row in the UI.
    var _dayData = DAYS.map(function(d) {
        return {
            key:       d.key,
            label:     d.label,
            enabled:   false,
            startTime: '09:00',
            endTime:   '17:00'
        };
    });

    // Top-level D3 selections kept in closure for update cycles.
    var _widget     = d3_select(null);
    var _textInput  = d3_select(null);
    var _toggleBtn  = d3_select(null);
    var _visualView = d3_select(null);
    var _textView   = d3_select(null);


    // ── main render function ───────────────────────────────────────────────
    function openingHours(selection) {

        // .form-field-input-wrap is provided by the field.js framework.
        // We add one more wrapper so we can control layout independently.
        _widget = selection.selectAll('.oh-widget')
            .data([0]);

        _widget = _widget.enter()
            .append('div')
            .attr('class', 'oh-widget')
            .merge(_widget);

        buildToggleBar(_widget);
        buildVisualView(_widget);
        buildTextView(_widget);

        updateViewVisibility();
    }


    // ── toggle bar ────────────────────────────────────────────────────────
    function buildToggleBar(parent) {
        var bar = parent.selectAll('.oh-toggle-bar')
            .data([0]);

        bar = bar.enter()
            .append('div')
            .attr('class', 'oh-toggle-bar')
            .merge(bar);

        // Conditional-rules warning badge
        bar.selectAll('.oh-conditional-badge')
            .data([0])
            .enter()
            .append('span')
            .attr('class', 'oh-conditional-badge');

        bar.select('.oh-conditional-badge')
            .text('⚠️ Conditional rules exist')
            .classed('hide', !_hasConditional);

        _toggleBtn = bar.selectAll('.oh-toggle-btn')
            .data([0]);

        _toggleBtn = _toggleBtn.enter()
            .append('button')
            .attr('class', 'oh-toggle-btn form-field-button')
            .merge(_toggleBtn);

        _toggleBtn
            .text(_visualMode ? t('opening_hours.switch_to_text', { default: 'Switch to Text View' })
                              : t('opening_hours.switch_to_visual', { default: 'Switch to Visual View' }))
            .on('click.oh-toggle', function(d3_event) {
                d3_event.preventDefault();

                if (!_visualMode) {
                    // Switching text → visual: attempt to parse the raw value.
                    // If parsing fails (complex expression), stay in text mode.
                    var parsed = parseRawValue(utilGetSetValue(_textInput));
                    if (!parsed) return;   // can't represent it visually
                    _visualMode = true;
                    renderDayRows();
                } else {
                    // Switching visual → text: serialise the current model.
                    _visualMode = false;
                    utilGetSetValue(_textInput, serialiseModel());
                }

                updateViewVisibility();
            });
    }


    // ── visual view ───────────────────────────────────────────────────────
    function buildVisualView(parent) {
        _visualView = parent.selectAll('.oh-visual-view')
            .data([0]);

        _visualView = _visualView.enter()
            .append('div')
            .attr('class', 'oh-visual-view')
            .merge(_visualView);

        // Ensure the <ul> exists before renderDayRows() queries it.
        _visualView.selectAll('ul.oh-days')
            .data([0])
            .enter()
            .append('ul')
            .attr('class', 'oh-days');

        // Populate with the initial _dayData.
        renderDayRows();
    }


    function renderDayRows() {
        var list = _visualView.select('ul.oh-days');
        if (list.empty()) return;   // not yet mounted

        var rows = list.selectAll('li.oh-day-row')
            .data(_dayData, function(d) { return d.key; });

        // ── ENTER ──────────────────────────────────────────────────────
        var enter = rows.enter()
            .append('li')
            .attr('class', 'oh-day-row');

        // Checkbox
        enter.append('input')
            .attr('type', 'checkbox')
            .attr('class', 'oh-day-checkbox')
            .attr('id', function(d) { return 'oh-check-' + d.key; })
            .attr('title', function(d) { return d.label; })
            .on('change.oh-checkbox', function(d3_event, d) {
                d.enabled = d3_select(this).property('checked');
                renderDayRows();
                fireChange();
            });

        // Day label
        enter.append('label')
            .attr('class', 'oh-day-label')
            .attr('for', function(d) { return 'oh-check-' + d.key; })
            .text(function(d) { return d.label; });

        // Start-time input
        enter.append('input')
            .attr('type', 'time')
            .attr('class', 'oh-time-start')
            .attr('id', function(d) { return 'oh-start-' + d.key; })
            .call(utilNoAuto)
            .on('change.oh-time', onTimeChange);

        // Separator
        enter.append('span')
            .attr('class', 'oh-time-sep')
            .text('–');

        // End-time input
        enter.append('input')
            .attr('type', 'time')
            .attr('class', 'oh-time-end')
            .attr('id', function(d) { return 'oh-end-' + d.key; })
            .call(utilNoAuto)
            .on('change.oh-time', onTimeChange);

        // "(Next Day)" hint – hidden by default, revealed by cross-midnight logic
        enter.append('span')
            .attr('class', 'oh-next-day')
            .classed('hide', true)
            .text(t('opening_hours.next_day', { default: '(Next Day)' }));

        // ── UPDATE (enter + existing) ──────────────────────────────────
        var merged = rows.merge(enter);

        merged.classed('oh-day-enabled', function(d) { return d.enabled; });

        merged.select('.oh-day-checkbox')
            .property('checked', function(d) { return d.enabled; });

        merged.select('.oh-time-start')
            .property('value', function(d) { return d.startTime; })
            .property('disabled', function(d) { return !d.enabled; });

        merged.select('.oh-time-end')
            .property('value', function(d) { return d.endTime; })
            .property('disabled', function(d) { return !d.enabled; });

        // Evaluate cross-midnight condition for every row
        merged.each(function(d) {
            var row = d3_select(this);
            updateNextDayHint(row, d);
        });

        // EXIT
        rows.exit().remove();
    }


    // ── text (fallback) view ───────────────────────────────────────────────
    function buildTextView(parent) {
        _textView = parent.selectAll('.oh-text-view')
            .data([0]);

        _textView = _textView.enter()
            .append('div')
            .attr('class', 'oh-text-view')
            .merge(_textView);

        _textInput = _textView.selectAll('input.oh-text-input')
            .data([0]);

        _textInput = _textInput.enter()
            .append('input')
            .attr('type', 'text')
            .attr('class', 'oh-text-input')
            .attr('id', field.domId + '-text')
            .attr('placeholder', field.placeholder() || t('inspector.unknown'))
            .call(utilNoAuto)
            .on('input.oh-text', change(true))
            .on('blur.oh-text',  change())
            .on('change.oh-text', change())
            .merge(_textInput);
    }


    // ── event helpers ──────────────────────────────────────────────────────

    /**
     * Fires whenever a time <input type="time"> changes.
     * Updates the datum, re-renders the row state, and checks
     * the cross-midnight condition.
     */
    function onTimeChange(d3_event, d) {
        var input = d3_select(this);
        var isStart = input.classed('oh-time-start');

        if (isStart) {
            d.startTime = this.value || d.startTime;
        } else {
            d.endTime = this.value || d.endTime;
        }

        var row = d3_select(this.closest('li.oh-day-row'));
        updateNextDayHint(row, d);
        fireChange();
    }

    /**
     * Shows or hides the "(Next Day)" span for a single day row.
     * Cross-midnight is detected when endTime < startTime numerically.
     */
    function updateNextDayHint(row, d) {
        var hint = row.select('.oh-next-day');
        if (hint.empty()) return;

        var crossesMidnight = false;
        if (d.enabled && d.startTime && d.endTime) {
            crossesMidnight = timeToMinutes(d.endTime) < timeToMinutes(d.startTime);
        }
        hint.classed('hide', !crossesMidnight);
    }

    /** Converts 'HH:MM' → total minutes for numeric comparison. */
    function timeToMinutes(timeStr) {
        var parts = (timeStr || '00:00').split(':');
        return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
    }

    /** Generic change handler for the raw text input (mirrors textarea.js). */
    function change(onInput) {
        return function() {
            var val = utilGetSetValue(_textInput);
            if (!onInput) val = context.cleanTagValue(val);

            // don't override multiple values with blank string
            if (!val && Array.isArray(_tags[field.key])) return;

            var t = {};
            t[field.key] = val || undefined;
            dispatch.call('change', this, t, onInput);
        };
    }

    /** Collects the visual model's state and dispatches a change event. */
    function fireChange() {
        var val = serialiseModel();
        var t = {};
        t[field.key] = val || undefined;
        dispatch.call('change', this, t);
    }

    /** Syncs view visibility and toggle-button label after a mode switch. */
    function updateViewVisibility() {
        _visualView.classed('hide', !_visualMode);
        _textView.classed('hide', _visualMode);

        _toggleBtn
            .text(_visualMode
                ? t('opening_hours.switch_to_text',   { default: 'Switch to Text View' })
                : t('opening_hours.switch_to_visual', { default: 'Switch to Visual View' })
            );
    }


    // ── serialise / parse ──────────────────────────────────────────────────

    /**
     * Converts _dayData into an opening_hours string, grouping contiguous
     * days that share the same schedule into hyphenated ranges.
     * Produces e.g. "Mo-We 09:00-17:00; Fr 10:00-14:00" or "Mo-Su 09:00-17:00".
     */
    function serialiseModel() {
        var groups = [];
        var currentGroup = null;

        _dayData.forEach(function(d) {
            if (!d.enabled) {
                if (currentGroup) {
                    groups.push(currentGroup);
                    currentGroup = null;
                }
                return;
            }

            if (!currentGroup) {
                currentGroup = {
                    startDay: d.key,
                    endDay: d.key,
                    startTime: d.startTime,
                    endTime: d.endTime
                };
            } else if (currentGroup.startTime === d.startTime && currentGroup.endTime === d.endTime) {
                // Extend the group if times match
                currentGroup.endDay = d.key;
            } else {
                // Times differ, flush current and start a new group
                groups.push(currentGroup);
                currentGroup = {
                    startDay: d.key,
                    endDay: d.key,
                    startTime: d.startTime,
                    endTime: d.endTime
                };
            }
        });

        if (currentGroup) {
            groups.push(currentGroup);
        }

        var parts = groups.map(function(g) {
            var dayStr = (g.startDay === g.endDay) ? g.startDay : (g.startDay + '-' + g.endDay);
            return dayStr + ' ' + g.startTime + '-' + g.endTime;
        });

        return parts.join('; ');
    }

    /**
     * Attempts a best-effort parse of a raw opening_hours string into _dayData.
     * Handles simple "Mo 09:00-17:00; Tu-Fr 08:00-18:00" patterns.
     *
     * @param  {string}  raw – the raw tag value
     * @return {boolean} true if every non-empty rule was successfully parsed;
     *                   false if any rule was too complex for the visual model
     *                   (e.g. "sunrise-sunset", "PH off", "24/7").
     */
    function parseRawValue(raw) {
        // Empty / undefined is trivially parsable (all days off).
        if (!raw) {
            _dayData.forEach(function(d) { d.enabled = false; });
            return true;
        }

        // Reset all days before filling them in.
        _dayData.forEach(function(d) { d.enabled = false; });

        var rules = raw.split(';');
        var allParsed = true;

        rules.forEach(function(rule) {
            rule = rule.trim();
            if (!rule) return;   // trailing semicolons are fine

            // Match:   Mo-Fr 09:00-17:00   or   Mo 09:00-17:00
            var m = rule.match(
                /^([A-Za-z]{2})(?:-([A-Za-z]{2}))?\s+(\d{2}:\d{2})-(\d{2}:\d{2})$/
            );
            if (!m) {
                allParsed = false;
                return;
            }

            var startKey  = m[1];
            var endKey    = m[2] || null;
            var startTime = m[3];
            var endTime   = m[4];

            var startIdx = DAYS.findIndex(function(d) { return d.key === startKey; });
            var endIdx   = endKey
                ? DAYS.findIndex(function(d) { return d.key === endKey; })
                : startIdx;

            // Unknown day abbreviation ⇒ unparsable
            if (startIdx === -1 || endIdx === -1) {
                allParsed = false;
                return;
            }

            for (var i = startIdx; i <= endIdx; i++) {
                _dayData[i].enabled   = true;
                _dayData[i].startTime = startTime;
                _dayData[i].endTime   = endTime;
            }
        });

        return allParsed;
    }


    // ── public API (mirrors other field modules) ──────────────────────────

    /**
     * Called by field.js whenever the tag data for this field changes
     * (e.g. user selects a new feature, undo/redo, or remote edit).
     *
     * Flow:
     *  1. Stash the raw tag value into the text-fallback input.
     *  2. Attempt to parse it into the visual _dayData model.
     *  3. If parsing succeeds → show the visual view.
     *     If parsing fails   → auto-flip to text mode so the raw string
     *                           is always visible and editable.
     */
    openingHours.tags = function(tags) {
        _tags = tags;

        // Check if a conditional tag exists on this feature.
        _hasConditional = !!tags['opening_hours:conditional'];

        var raw     = tags[field.key];
        var isMixed = Array.isArray(raw);
        var val     = !isMixed ? (raw || '') : '';

        // Auto-clean bad data (e.g. pasted from wiki) so it actually updates the DB
        if (val) {
            var cleaned = val.replace(/^opening_hours\s*=\s*/i, '')
                             .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2043\u02D7\u2212\u2796\u2CBB]/g, '-');
            if (cleaned !== val) {
                val = cleaned;
                // Defer the change dispatch so we don't disrupt the current update cycle
                window.setTimeout(function() {
                    var t = {};
                    t[field.key] = val || undefined;
                    dispatch.call('change', _textInput.node(), t);
                }, 0);
            }
        }

        // Always keep the text fallback in sync.
        utilGetSetValue(_textInput, val)
            .attr('title',       isMixed ? raw.filter(Boolean).join('\n') : undefined)
            .attr('placeholder', isMixed ? t('inspector.multiple_values')
                                         : (field.placeholder() || t('inspector.unknown')))
            .classed('mixed', isMixed);

        // Try to map the raw value into the visual model.
        var parsed = parseRawValue(val);
        var isFocused = _textInput.node() && document.activeElement === _textInput.node();

        if (parsed && !isMixed) {
            // Simple expression — visual mode can represent it.
            if (!isFocused) {
                _visualMode = true;
            }
            renderDayRows();
        } else {
            // Complex / mixed expression — fall back to raw text input.
            _visualMode = false;
        }

        updateViewVisibility();
    };

    openingHours.focus = function() {
        var node = _textInput.node();
        if (node) node.focus();
    };

    return utilRebind(openingHours, dispatch, 'on');
}
