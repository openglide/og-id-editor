import { dispatch as d3_dispatch } from 'd3-dispatch';
import { select as d3_select } from 'd3-selection';
import { isEmpty } from 'lodash-es';

import { services } from '../../services';
import { svgIcon } from '../../svg/icon';
import { uiCombobox } from '../combobox';
import { uiSection } from '../section';
import { uiTagReference } from '../tag_reference';
import { prefs } from '../../core/preferences';
import { t } from '../../core/localizer';
import { utilArrayDifference, utilArrayIdentical } from '../../util/array';
import { utilGetSetValue, utilNoAuto, utilRebind, utilTagDiff } from '../../util';
import { allowUpperCaseTagValues } from '../../osm/tags';
import { fileFetcher } from '../../core';


export function uiSectionRawTagEditor(id, context) {

    var section = uiSection(id, context)
        .classes('raw-tag-editor')
        .label(function() {
            var count = Object.keys(_tags).filter(function(d) { return d; }).length;
            return t.append('inspector.title_count', { title: t('inspector.tags'), count: count });
        })
        .expandedByDefault(false)
        .disclosureContent(renderDisclosureContent);

    var taginfo = services.taginfo;
    var dispatch = d3_dispatch('change');
    var availableViews = [
        { id: 'list', icon: '#fas-th-list' },
        { id: 'text', icon: '#fas-i-cursor' }
    ];

    let _discardTags = {};
    fileFetcher.get('discarded')
        .then((d) => { _discardTags = d; })
        .catch(() => { /* ignore */ });

    var _tagView = (prefs('raw-tag-editor-view') || 'list');   // 'list, 'text'
    var _readOnlyTags = [];
    // the keys in the order we want them to display
    var _orderedKeys = [];
    var _pendingChange = null;
    var _state;
    var _presets;
    var _tags;
    var _entityIDs;
    var _didInteract = false;

    function interacted() {
        _didInteract = true;
    }

    function renderDisclosureContent(wrap) {

        // remove deleted keys
        _orderedKeys = _orderedKeys.filter(function(key) {
            return _tags[key] !== undefined;
        });

        // When switching to a different entity or changing the state (hover/select)
        // reorder the keys alphabetically.
        // We trigger this by emptying the `_orderedKeys` array, then it will be rebuilt here.
        // Otherwise leave their order alone - #5857, #5927
        var all = Object.keys(_tags).sort();
        var missingKeys = utilArrayDifference(all, _orderedKeys);
        for (var i in missingKeys) {
            _orderedKeys.push(missingKeys[i]);
        }

        // assemble row data
        var rowData = _orderedKeys.map(function(key, i) {
            return { index: i, key: key, value: _tags[key] };
        });

        // append blank row last
        rowData.push({ index: rowData.length, key: '', value: '' });


        // View Options
        var options = wrap.selectAll('.raw-tag-options')
            .data([0]);

        options.exit()
            .remove();

        var optionsEnter = options.enter()
            .insert('div', ':first-child')
            .attr('class', 'raw-tag-options')
            .attr('role', 'tablist');

        var optionEnter = optionsEnter.selectAll('.raw-tag-option')
            .data(availableViews, function(d) { return d.id; })
            .enter();

        optionEnter
            .append('button')
            .attr('class', function(d) {
                return 'raw-tag-option raw-tag-option-' + d.id + (_tagView === d.id ? ' selected' : '');
            })
            .attr('aria-selected', function(d) { return _tagView === d.id; })
            .attr('role', 'tab')
            .attr('title', function(d) { return t('icons.' + d.id); })
            .on('click', function(d3_event, d) {
                _tagView = d.id;
                prefs('raw-tag-editor-view', d.id);

                wrap.selectAll('.raw-tag-option')
                    .classed('selected', function(datum) { return datum === d; })
                    .attr('aria-selected', function(datum) { return datum === d; });

                wrap.selectAll('.tag-text')
                    .classed('hide', (d.id !== 'text'))
                    .each(setTextareaHeight);

                wrap.selectAll('.tag-list, .add-row')
                    .classed('hide', (d.id !== 'list'));
            })
            .each(function(d) {
                d3_select(this)
                    .call(svgIcon(d.icon));
            });


        // View as Text
        var textData = rowsToText(rowData);
        var textarea = wrap.selectAll('.tag-text')
            .data([0]);

        textarea = textarea.enter()
            .append('textarea')
            .attr('class', 'tag-text' + (_tagView !== 'text' ? ' hide' : ''))
            .call(utilNoAuto)
            .attr('placeholder', t('inspector.key_value'))
            .attr('spellcheck', 'false')
            .merge(textarea);

        textarea
            .call(utilGetSetValue, textData)
            .each(setTextareaHeight)
            .on('input', setTextareaHeight)
            .on('focus', interacted)
            .on('blur', textChanged)
            .on('change', textChanged);


        // View as List
        var list = wrap.selectAll('.tag-list')
            .data([0]);

        list = list.enter()
            .append('ul')
            .attr('class', 'tag-list' + (_tagView !== 'list' ? ' hide' : ''))
            .merge(list);


        // Tag list items
        var items = list.selectAll('.tag-row')
            .data(rowData, function(d) { return d.key; });

        items.exit()
            .each(unbind)
            .remove();


        // Enter
        var itemsEnter = items.enter()
            .append('li')
            .attr('class', 'tag-row')
            .classed('readonly', isReadOnly);

        var innerWrap = itemsEnter.append('div')
            .attr('class', 'inner-wrap');

        innerWrap
            .append('div')
            .attr('class', 'key-wrap')
            .append('input')
            .property('type', 'text')
            .attr('class', 'key')
            .call(utilNoAuto)
            .on('focus', interacted)
            .on('blur', keyChange)
            .on('change', keyChange);

        innerWrap
            .append('div')
            .attr('class', 'value-wrap')
            .append('input')
            .property('type', 'text')
            .attr('class', 'value')
            .call(utilNoAuto)
            .on('focus', interacted)
            .on('blur', valueChange)
            .on('change', valueChange);

        innerWrap
            .append('button')
            .attr('tabindex', -1)
            .attr('class', 'form-field-button remove')
            .attr('title', t('icons.remove'))
            .call(svgIcon('#iD-operation-delete'));


        // Update
        items = items
            .merge(itemsEnter)
            .sort(function(a, b) { return a.index - b.index; });

        items
            .classed('add-tag', d => d.key === '')
            .each(function(d) {
                var row = d3_select(this);
                var key = row.select('input.key');      // propagate bound data
                var value = row.select('input.value');  // propagate bound data

                if (_entityIDs && taginfo && _state !== 'hover') {
                    bindTypeahead(key, value);
                }

                var referenceOptions = { key: d.key };
                if (typeof d.value === 'string') {
                    referenceOptions.value = d.value;
                }
                var reference = uiTagReference(referenceOptions, context);

                if (_state === 'hover') {
                    reference.showing(false);
                }

                row.select('.inner-wrap')      // propagate bound data
                    .call(reference.button)
                    .select('.tag-reference-button')
                    .attr('tabindex', -1)
                    .classed('disabled', d => d.key === '');  // disabled for blank tag line

                row.call(reference.body);

                row.select('button.remove');   // propagate bound data
            });

        items.selectAll('input.key')
            .attr('title', function(d) { return d.key; })
            .attr('readonly', function(d) {
                return isReadOnly(d) || null;
            })
            .call(utilGetSetValue,
                d => d.key,
                (_, newKey) => _pendingChange === null || isEmpty(_pendingChange) || _pendingChange[newKey] // if there are pending changes: skip untouched keys
            );

        items.selectAll('input.value')
            .attr('title', function(d) {
                return Array.isArray(d.value) ? d.value.filter(Boolean).join('\n') : d.value;
            })
            .classed('mixed', function(d) {
                return Array.isArray(d.value);
            })
            .attr('placeholder', function(d) {
                return typeof d.value === 'string' ? null : t('inspector.multiple_values');
            })
            .attr('readonly', function(d) {
                return isReadOnly(d) || null;
            })
            .call(utilGetSetValue,
                d => {
                    if (_pendingChange !== null && !isEmpty(_pendingChange) && !_pendingChange[d.value]) {
                        // if there are pending changes: skip untouched values
                        return null;
                    }
                    return typeof d.value === 'string' ? d.value : '';
                }, (_, newValue) => newValue !== null
            );

        items.selectAll('button.remove')
            .classed('disabled', d => d.key === '')  // disabled for blank tag line
            .on(('PointerEvent' in window ? 'pointer' : 'mouse') + 'down', // 'click' fires too late - #5878
                (d3_event, d) => {
                    if (d3_event.button !== 0) return;
                    removeTag(d3_event, d);
                });

    }

    function isReadOnly(d) {
        for (var i = 0; i < _readOnlyTags.length; i++) {
            if (d.key.match(_readOnlyTags[i]) !== null) {
                return true;
            }
        }
        return false;
    }

    function setTextareaHeight() {
        if (_tagView !== 'text') return;

        var selection = d3_select(this);
        var matches = selection.node().value.match(/\n/g);
        var lineCount = 2 + Number(matches && matches.length);
        var lineHeight = 20;

        selection.style('height', lineCount * lineHeight + 'px');
    }

    function stringify(s) {
        const stringified = JSON.stringify(s).slice(1, -1);   // without leading/trailing "
        if (stringified !== s) {
            return `"${stringified}"`;
        } else {
            return s;
        }
    }

    function unstringify(s) {
        const isQuoted = s.length > 1 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"';
        if (isQuoted) {
            try {
                return JSON.parse(s);
            } catch {
                return s;
            }
        } else {
            return s;
        }
    }

    function rowsToText(rows) {
        var str = rows
            .filter(function(row) { return row.key && row.key.trim() !== ''; })
            .map(function(row) {
                var rawVal = row.value;
                if (typeof rawVal !== 'string') rawVal = '*';
                var val = rawVal ? stringify(rawVal) : '';
                return stringify(row.key) + '=' + val;
            })
            .join('\n');

        if (_state !== 'hover' && str.length) {
            return str + '\n';
        }
        return  str;
    }

    function textChanged() {
        var newText = this.value.trim();
        var newTags = {};
        newText.split('\n').forEach(function(row) {
            var m = row.match(/^\s*([^=]+)=(.*)$/);
            if (m !== null) {
                var k = context.cleanTagKey(unstringify(m[1].trim()));
                var v = context.cleanTagValue(unstringify(m[2].trim()));
                newTags[k] = v;
            }
        });

        var tagDiff = utilTagDiff(_tags, newTags);

        _pendingChange  = _pendingChange || {};

        tagDiff.forEach(function(change) {
            if (isReadOnly({ key: change.key })) return;

            // skip unchanged multiselection placeholders
            if (change.newVal === '*' && typeof change.oldVal !== 'string') return;

            if (change.type === '-') {
                _pendingChange[change.key] = undefined;
            } else if (change.type === '+') {
                _pendingChange[change.key] = change.newVal || '';
            }
        });

        if (isEmpty(_pendingChange)) {
            _pendingChange = null;
            section.reRender();
            return;
        }

        scheduleChange();
    }

    function bindTypeahead(key, value) {
        if (isReadOnly(key.datum())) return;

        if (Array.isArray(value.datum().value)) {
            value.call(uiCombobox(context, 'tag-value')
                .minItems(1)
                .fetcher(function(value, callback) {
                    var keyString = utilGetSetValue(key);
                    if (!_tags[keyString]) return;
                    var data = _tags[keyString].map(function(tagValue) {
                        if (!tagValue) {
                            return {
                                value: ' ',
                                title: t('inspector.empty'),
                                display: selection => selection.text('')
                                    .classed('virtual-option', true)
                                    .call(t.append('inspector.empty'))
                            };
                        }
                        return {
                            value: tagValue,
                            title: tagValue
                        };
                    });
                    callback(data);
                }));
            return;
        }

        var geometry = context.graph().geometry(_entityIDs[0]);

        key.call(uiCombobox(context, 'tag-key')
            .fetcher(function(value, callback) {
                taginfo.keys({
                    debounce: true,
                    geometry: geometry,
                    query: value
                }, function(err, data) {
                    if (!err) {
                        const filtered = data
                            .filter(d => _tags[d.value] === undefined) // already used tag
                            .filter(d => !(d.value in _discardTags)) // do not suggest discardable tags (see #9817)
                            .filter(d => !/_\d$/.test(d)) // tag like name_1 (see #9422)
                            .filter(d => d.value.toLowerCase().includes(value.toLowerCase())); // tag does not match user input
                        callback(sort(value, filtered));
                    }
                });
            }));

        value.call(uiCombobox(context, 'tag-value')
            .fetcher(function(value, callback) {
                taginfo.values({
                    debounce: true,
                    key: utilGetSetValue(key),
                    geometry: geometry,
                    query: value
                }, function(err, data) {
                    if (!err) {
                        const filtered = data.filter(d => d.value.toLowerCase().includes(value.toLowerCase()));
                        callback(sort(value, filtered));
                    }
                });
            })
            .caseSensitive(allowUpperCaseTagValues.test(utilGetSetValue(key))));


        function sort(value, data) {
            var sameletter = [];
            var other = [];
            for (var i = 0; i < data.length; i++) {
                if (data[i].value.substring(0, value.length) === value) {
                    sameletter.push(data[i]);
                } else {
                    other.push(data[i]);
                }
            }
            return sameletter.concat(other);
        }
    }

    function unbind() {
        var row = d3_select(this);

        row.selectAll('input.key')
            .call(uiCombobox.off, context);

        row.selectAll('input.value')
            .call(uiCombobox.off, context);
    }

    function keyChange(d3_event, d) {
        if (d3_select(this).attr('readonly')) return;

        var kOld = d.key;

        // exit if we are currently about to delete this row anyway - #6366
        if (_pendingChange && _pendingChange.hasOwnProperty(kOld) && _pendingChange[kOld] === undefined) return;

        var kNew = context.cleanTagKey(this.value.trim());

        // allow no change if the key should be readonly
        if (isReadOnly({ key: kNew })) {
            this.value = kOld;
            return;
        }

        if (kNew &&
            kNew !== kOld &&
            _tags[kNew] !== undefined) {
            // new key is already in use, switch focus to the existing row

            this.value = kOld;                // reset the key
            section.selection().selectAll('.tag-list input.value')
                .each(function(d) {
                    if (d.key === kNew) {     // send focus to that other value combo instead
                        var input = d3_select(this).node();
                        input.focus();
                        input.select();
                    }
                });
            return;
        }


        _pendingChange = _pendingChange || {};

        if (kOld) {
            if (kOld === kNew) return;
            // a tag key was renamed
            _pendingChange[kNew] = _pendingChange[kOld] || { oldKey: kOld };
            _pendingChange[kOld] = undefined;
        } else {
            // a new tag was added
            let row = this.parentNode.parentNode;
            let inputVal = d3_select(row).selectAll('input.value');
            let vNew = context.cleanTagValue(utilGetSetValue(inputVal));
            _pendingChange[kNew] = vNew;
            utilGetSetValue(inputVal, vNew);
        }

        // update the ordered key index so this row doesn't change position
        var existingKeyIndex = _orderedKeys.indexOf(kOld);
        if (existingKeyIndex !== -1) _orderedKeys[existingKeyIndex] = kNew;

        d.key = kNew;    // update datum to avoid exit/enter on tag update

        this.value = kNew;
        scheduleChange();
    }

    function valueChange(d3_event, d) {
        if (isReadOnly(d)) return;

        // exit if this is a multiselection and no value was entered
        if (typeof d.value !== 'string' && !this.value) return;

        // exit if we are currently about to delete this row anyway - #6366
        if (_pendingChange && _pendingChange.hasOwnProperty(d.key) && _pendingChange[d.key] === undefined) return;

        _pendingChange = _pendingChange || {};

        _pendingChange[d.key] = context.cleanTagValue(this.value);
        scheduleChange();
    }

    function removeTag(d3_event, d) {
        if (isReadOnly(d)) return;

        // remove the key from the ordered key index
        _orderedKeys = _orderedKeys.filter(function(key) { return key !== d.key; });

        _pendingChange  = _pendingChange || {};
        _pendingChange[d.key] = undefined;
        scheduleChange();
    }

    function scheduleChange() {
        if (!_pendingChange) return;

        for (const key in _pendingChange) {
            _tags[key] = _pendingChange[key];
        }
        dispatch.call('change', this, _entityIDs, _pendingChange);
        _pendingChange = null;
    }


    section.state = function(val) {
        if (!arguments.length) return _state;
        if (_state !== val) {
            _orderedKeys = [];
            _state = val;
        }
        return section;
    };


    section.presets = function(val) {
        if (!arguments.length) return _presets;
        _presets = val;
        if (_presets && _presets.length && _presets[0].isFallback()) {
            section.disclosureExpanded(true);

        // don't collapse the disclosure if the mapper used the raw tag editor - #1881
        } else if (!_didInteract) {
            section.disclosureExpanded(null);
        }
        return section;
    };


    section.tags = function(val) {
        if (!arguments.length) return _tags;
        _tags = val;
        return section;
    };


    section.entityIDs = function(val) {
        if (!arguments.length) return _entityIDs;
        if (!_entityIDs || !val || !utilArrayIdentical(_entityIDs, val)) {
            _entityIDs = val;
            _orderedKeys = [];
        }
        return section;
    };


    // pass an array of regular expressions to test against the tag key
    section.readOnlyTags = function(val) {
        if (!arguments.length) return _readOnlyTags;
        _readOnlyTags = val;
        return section;
    };


    return utilRebind(section, dispatch, 'on');
}
