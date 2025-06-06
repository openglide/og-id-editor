import _throttle from 'lodash-es/throttle';

import { geoPath as d3_geoPath } from 'd3-geo';
import RBush from 'rbush';
import { localizer } from '../core/localizer';

import {
    geoExtent, geoPolygonIntersectsPolygon, geoPathLength,
    geoScaleToZoom, geoVecInterp, geoVecLength
} from '../geo';
import { presetManager } from '../presets';
import { osmEntity, osmIsInterestingTag } from '../osm';
import { utilDetect } from '../util/detect';
import { utilArrayDifference, utilDisplayName, utilDisplayNameForPath, utilEntitySelector } from '../util';



export function svgLabels(projection, context) {
    var path = d3_geoPath(projection);
    var detected = utilDetect();
    var baselineHack = (detected.ie ||
        detected.browser.toLowerCase() === 'edge' ||
        (detected.browser.toLowerCase() === 'firefox' && detected.version >= 70));
    var _rdrawn = new RBush();
    var _rskipped = new RBush();
    var _entitybboxes = {};

    // Listed from highest to lowest priority
    const labelStack = [
        ['line', 'aeroway', '*', 12],
        ['line', 'highway', 'motorway', 12],
        ['line', 'highway', 'trunk', 12],
        ['line', 'highway', 'primary', 12],
        ['line', 'highway', 'secondary', 12],
        ['line', 'highway', 'tertiary', 12],
        ['line', 'highway', '*', 12],
        ['line', 'railway', '*', 12],
        ['line', 'waterway', '*', 12],
        ['area', 'aeroway', '*', 12],
        ['area', 'amenity', '*', 12],
        ['area', 'building', '*', 12],
        ['area', 'historic', '*', 12],
        ['area', 'leisure', '*', 12],
        ['area', 'man_made', '*', 12],
        ['area', 'natural', '*', 12],
        ['area', 'shop', '*', 12],
        ['area', 'tourism', '*', 12],
        ['area', 'camp_site', '*', 12],
        ['point', 'aeroway', '*', 10],
        ['point', 'amenity', '*', 10],
        ['point', 'building', '*', 10],
        ['point', 'historic', '*', 10],
        ['point', 'leisure', '*', 10],
        ['point', 'man_made', '*', 10],
        ['point', 'natural', '*', 10],
        ['point', 'shop', '*', 10],
        ['point', 'tourism', '*', 10],
        ['point', 'camp_site', '*', 10],
        ['line', 'ref', '*', 12],
        ['area', 'ref', '*', 12],
        ['point', 'ref', '*', 10],
        ['line', 'name', '*', 12],
        ['area', 'name', '*', 12],
        ['point', 'name', '*', 10],
        ['point', 'addr:housenumber', '*', 10],
        ['point', 'addr:housename', '*', 10]
    ];


    function shouldSkipIcon(preset) {
        var noIcons = ['building', 'landuse', 'natural'];
        return noIcons.some(function(s) {
            return preset.id.indexOf(s) >= 0;
        });
    }


    function drawLinePaths(selection, labels, filter, classes) {
        var paths = selection.selectAll('path:not(.debug)')
            .filter(d => filter(d.entity))
            .data(labels, d => osmEntity.key(d.entity));

        // exit
        paths.exit()
            .remove();

        // enter/update
        paths.enter()
            .append('path')
            .style('stroke-width', d => d.position['font-size'])
            .attr('id', d => 'ideditor-labelpath-' + d.entity.id)
            .attr('class', classes)
            .merge(paths)
            .attr('d', d => d.position.lineString);
    }


    function drawLineLabels(selection, labels, filter, classes) {
        var texts = selection.selectAll('text.' + classes)
            .filter(d => filter(d.entity))
            .data(labels, d => osmEntity.key(d.entity));

        // exit
        texts.exit()
            .remove();

        // enter
        texts.enter()
            .append('text')
            .attr('class', d => classes + ' ' + d.position.classes + ' ' + d.entity.id)
            .attr('dy', baselineHack ? '0.35em' : null)
            .append('textPath')
            .attr('class', 'textpath');

        // update
        selection.selectAll('text.' + classes).selectAll('.textpath')
            .filter(d => filter(d.entity))
            .data(labels, d => osmEntity.key(d.entity))
            .attr('startOffset', '50%')
            .attr('xlink:href', function(d) { return '#ideditor-labelpath-' + d.entity.id; })
            .text(d => d.name);
    }


    function drawPointLabels(selection, labels, filter, classes) {
        if (classes.includes('pointlabel-halo')) {
            labels = labels.filter(d => !d.position.isAddr);
        }
        var texts = selection.selectAll('text.' + classes)
            .filter(d => filter(d.entity))
            .data(labels, d => osmEntity.key(d.entity));

        // exit
        texts.exit()
            .remove();

        // enter/update
        texts.enter()
            .append('text')
            .attr('class', d => classes + ' ' + d.position.classes + ' ' + d.entity.id)
            .style('text-anchor', d => d.position.textAnchor)
            .text(d => d.name)
            .merge(texts)
            .attr('x', d => d.position.x)
            .attr('y', d => d.position.y);
    }


    function drawAreaLabels(selection, labels, filter, classes) {
        labels = labels.filter(hasText);
        drawPointLabels(selection, labels, filter, classes);

        function hasText(d) {
            return d.position.hasOwnProperty('x') && d.position.hasOwnProperty('y');
        }
    }


    function drawAreaIcons(selection, labels, filter, classes) {
        var icons = selection.selectAll('use.' + classes)
            .filter(d => filter(d.entity))
            .data(labels, d => osmEntity.key(d.entity));

        // exit
        icons.exit()
            .remove();

        // enter/update
        icons.enter()
            .append('use')
            .attr('class', 'icon ' + classes)
            .attr('width', '17px')
            .attr('height', '17px')
            .merge(icons)
            .attr('transform', d => d.position.transform)
            .attr('xlink:href', function(d) {
                var preset = presetManager.match(d.entity, context.graph());
                var picon = preset && preset.icon;
                return picon ? '#' + picon : '';
            });
    }


    function drawCollisionBoxes(selection, rtree, which) {
        var classes = 'debug ' + which + ' ' + (which === 'debug-skipped' ? 'orange' : 'yellow');

        var gj = [];
        if (context.getDebug('collision')) {
            gj = rtree.all().map(function(d) {
                return { type: 'Polygon', coordinates: [[
                    [d.minX, d.minY],
                    [d.maxX, d.minY],
                    [d.maxX, d.maxY],
                    [d.minX, d.maxY],
                    [d.minX, d.minY]
                ]]};
            });
        }

        var boxes = selection.selectAll('.' + which)
            .data(gj);

        // exit
        boxes.exit()
            .remove();

        // enter/update
        boxes.enter()
            .append('path')
            .attr('class', classes)
            .merge(boxes)
            .attr('d', d3_geoPath());
    }


    function drawLabels(selection, graph, entities, filter, dimensions, fullRedraw) {
        var wireframe = context.surface().classed('fill-wireframe');
        var zoom = geoScaleToZoom(projection.scale());

        var labelable = [];
        var renderNodeAs = {};
        var i, j, k, entity, geometry;

        for (i = 0; i < labelStack.length; i++) {
            labelable.push([]);
        }

        if (fullRedraw) {
            _rdrawn.clear();
            _rskipped.clear();
            _entitybboxes = {};

        } else {
            for (i = 0; i < entities.length; i++) {
                entity = entities[i];
                var toRemove = []
                    .concat(_entitybboxes[entity.id] || [])
                    .concat(_entitybboxes[entity.id + 'I'] || []);

                for (j = 0; j < toRemove.length; j++) {
                    _rdrawn.remove(toRemove[j]);
                    _rskipped.remove(toRemove[j]);
                }
            }
        }

        // Loop through all the entities to do some preprocessing
        for (i = 0; i < entities.length; i++) {
            entity = entities[i];
            geometry = entity.geometry(graph);

            // Insert collision boxes around interesting points/vertices
            if (geometry === 'point' || (geometry === 'vertex' && isInterestingVertex(entity))) {
                const isAddr = isAddressPoint(entity.tags);
                var hasDirections = entity.directions(graph, projection).length;
                var markerPadding = 0;

                if (wireframe) {
                    renderNodeAs[entity.id] = { geometry: 'vertex', isAddr };
                } else if (geometry === 'vertex') {
                    renderNodeAs[entity.id] = { geometry: 'vertex', isAddr };
                } else if (zoom >= 18 && hasDirections) {
                    renderNodeAs[entity.id] = { geometry: 'vertex', isAddr };
                } else {
                    renderNodeAs[entity.id] = { geometry: 'point', isAddr };
                    markerPadding = 20;   // extra y for marker height
                }

                if (isAddr) {
                    undoInsert(entity.id + 'P');
                } else {
                    var coord = projection(entity.loc);
                    var nodePadding = 10;
                    var bbox = {
                        minX: coord[0] - nodePadding,
                        minY: coord[1] - nodePadding - markerPadding,
                        maxX: coord[0] + nodePadding,
                        maxY: coord[1] + nodePadding
                    };
                    doInsert(bbox, entity.id + 'P');
                }
            }

            // From here on, treat vertices like points
            if (geometry === 'vertex') {
                geometry = 'point';
            }

            // Determine which entities are label-able
            var preset = geometry === 'area' && presetManager.match(entity, graph);
            var icon = preset && !shouldSkipIcon(preset) && preset.icon;

            if (!icon && !utilDisplayName(entity)) continue;

            for (k = 0; k < labelStack.length; k++) {
                var matchGeom = labelStack[k][0];
                var matchKey = labelStack[k][1];
                var matchVal = labelStack[k][2];
                var hasVal = entity.tags[matchKey];

                if (geometry === matchGeom && hasVal && (matchVal === '*' || matchVal === hasVal)) {
                    labelable[k].push(entity);
                    break;
                }
            }
        }

        var labelled = {
            point: [],
            line: [],
            area: []
        };

        // Try and find a valid label for labellable entities
        for (k = 0; k < labelable.length; k++) {
            var fontSize = labelStack[k][3];

            for (i = 0; i < labelable[k].length; i++) {
                entity = labelable[k][i];
                geometry = entity.geometry(graph);

                var getName = (geometry === 'line') ? utilDisplayNameForPath : utilDisplayName;
                var name = getName(entity);
                var width = name && textWidth(name, fontSize, selection.select('g.layer-osm.labels').node());
                var p = null;

                if (geometry === 'point' || geometry === 'vertex') {
                    // no point or vertex labels in wireframe mode
                    // no vertex labels at low zooms (vertices have no icons)
                    if (wireframe) continue;
                    var renderAs = renderNodeAs[entity.id];
                    if (renderAs.geometry === 'vertex' && zoom < 17) continue;
                    while (renderAs.isAddr && width > 36) {
                        name = `${name.substring(0, name.replace(/…$/, '').length - 1)}…`;
                        width = textWidth(name, fontSize, selection.select('g.layer-osm.labels').node());
                    }

                    p = getPointLabel(entity, width, fontSize, renderAs);
                } else if (geometry === 'line') {
                    p = getLineLabel(entity, width, fontSize);

                } else if (geometry === 'area') {
                    p = getAreaLabel(entity, width, fontSize);
                }

                if (p) {
                    if (geometry === 'vertex') { geometry = 'point'; }  // treat vertex like point
                    p.classes = geometry + ' tag-' + labelStack[k][1];
                    labelled[geometry].push({
                        entity,
                        name,
                        position: p
                    });
                }
            }
        }


        function isInterestingVertex(entity) {
            var selectedIDs = context.selectedIDs();

            return entity.hasInterestingTags() ||
                entity.isEndpoint(graph) ||
                entity.isConnected(graph) ||
                selectedIDs.indexOf(entity.id) !== -1 ||
                graph.parentWays(entity).some(function(parent) {
                    return selectedIDs.indexOf(parent.id) !== -1;
                });
        }


        function getPointLabel(entity, width, height, style) {
            var y = (style.geometry === 'point' ? -12 : 0);
            var pointOffsets = {
                ltr: [15, y, 'start'],
                rtl: [-15, y, 'end']
            };
            const isAddr = style.isAddr;

            var textDirection = localizer.textDirection();

            var coord = projection(entity.loc);
            var textPadding = 2;
            var offset = pointOffsets[textDirection];
            if (isAddr) offset = [0, 1, 'middle'];
            var p = {
                height: height,
                width: width,
                x: coord[0] + offset[0],
                y: coord[1] + offset[1],
                textAnchor: offset[2],
                isAddr
            };

            // insert a collision box for the text label..
            let bbox;
            if (isAddr) {
                bbox = {
                    minX: p.x - (width / 2) - textPadding,
                    minY: p.y - (height / 2) - textPadding,
                    maxX: p.x + (width / 2) + textPadding,
                    maxY: p.y + (height / 2) + textPadding
                };
            } else if (textDirection === 'rtl') {
                bbox = {
                    minX: p.x - width - textPadding,
                    minY: p.y - (height / 2) - textPadding,
                    maxX: p.x + textPadding,
                    maxY: p.y + (height / 2) + textPadding
                };
            } else {
                bbox = {
                    minX: p.x - textPadding,
                    minY: p.y - (height / 2) - textPadding,
                    maxX: p.x + width + textPadding,
                    maxY: p.y + (height / 2) + textPadding
                };
            }

            if (tryInsert([bbox], entity.id, true)) {
                return p;
            }
        }


        function getLineLabel(entity, width, height) {
            var viewport = geoExtent(context.projection.clipExtent()).polygon();
            var points = graph.childNodes(entity)
                .map(function(node) { return projection(node.loc); });
            var length = geoPathLength(points);

            if (length < width + 20) return;

            // % along the line to attempt to place the label
            var lineOffsets = [50, 45, 55, 40, 60, 35, 65, 30, 70,
                               25, 75, 20, 80, 15, 95, 10, 90, 5, 95];
            var padding = 3;

            for (var i = 0; i < lineOffsets.length; i++) {
                var offset = lineOffsets[i];
                var middle = offset / 100 * length;
                var start = middle - width / 2;

                if (start < 0 || start + width > length) continue;

                // generate subpath and ignore paths that are invalid or don't cross viewport.
                var sub = subpath(points, start, start + width);
                if (!sub || !geoPolygonIntersectsPolygon(viewport, sub, true)) {
                    continue;
                }

                var isReverse = reverse(sub);
                if (isReverse) {
                    sub = sub.reverse();
                }

                var bboxes = [];
                var boxsize = (height + 2) / 2;

                for (var j = 0; j < sub.length - 1; j++) {
                    var a = sub[j];
                    var b = sub[j + 1];

                    // split up the text into small collision boxes
                    var num = Math.max(1, Math.floor(geoVecLength(a, b) / boxsize / 2));

                    for (var box = 0; box < num; box++) {
                        var p = geoVecInterp(a, b, box / num);
                        var x0 = p[0] - boxsize - padding;
                        var y0 = p[1] - boxsize - padding;
                        var x1 = p[0] + boxsize + padding;
                        var y1 = p[1] + boxsize + padding;

                        bboxes.push({
                            minX: Math.min(x0, x1),
                            minY: Math.min(y0, y1),
                            maxX: Math.max(x0, x1),
                            maxY: Math.max(y0, y1)
                        });
                    }
                }

                if (tryInsert(bboxes, entity.id, false)) {   // accept this one
                    return {
                        'font-size': height + 2,
                        lineString: lineString(sub),
                        startOffset: offset + '%'
                    };
                }
            }

            function reverse(p) {
                var angle = Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]);
                return !(p[0][0] < p[p.length - 1][0] && angle < Math.PI/2 && angle > -Math.PI/2);
            }

            function lineString(points) {
                return 'M' + points.join('L');
            }

            function subpath(points, from, to) {
                var sofar = 0;
                var start, end, i0, i1;

                for (var i = 0; i < points.length - 1; i++) {
                    var a = points[i];
                    var b = points[i + 1];
                    var current = geoVecLength(a, b);
                    var portion;
                    if (!start && sofar + current >= from) {
                        portion = (from - sofar) / current;
                        start = [
                            a[0] + portion * (b[0] - a[0]),
                            a[1] + portion * (b[1] - a[1])
                        ];
                        i0 = i + 1;
                    }
                    if (!end && sofar + current >= to) {
                        portion = (to - sofar) / current;
                        end = [
                            a[0] + portion * (b[0] - a[0]),
                            a[1] + portion * (b[1] - a[1])
                        ];
                        i1 = i + 1;
                    }
                    sofar += current;
                }

                var result = points.slice(i0, i1);
                result.unshift(start);
                result.push(end);
                return result;
            }
        }


        function getAreaLabel(entity, width, height) {
            var centroid = path.centroid(entity.asGeoJSON(graph));
            var extent = entity.extent(graph);
            var areaWidth = projection(extent[1])[0] - projection(extent[0])[0];

            if (isNaN(centroid[0]) || areaWidth < 20) return;

            var preset = presetManager.match(entity, context.graph());
            var picon = preset && preset.icon;
            var iconSize = 17;
            var padding = 2;
            var p = {};

            if (picon && !shouldSkipIcon(preset)) {  // icon and label..
                if (addIcon()) {
                    addLabel(iconSize + padding);
                    return p;
                }
            } else {   // label only..
                if (addLabel(0)) {
                    return p;
                }
            }


            function addIcon() {
                var iconX = centroid[0] - (iconSize / 2);
                var iconY = centroid[1] - (iconSize / 2);
                var bbox = {
                    minX: iconX,
                    minY: iconY,
                    maxX: iconX + iconSize,
                    maxY: iconY + iconSize
                };

                if (tryInsert([bbox], entity.id + 'I', true)) {
                    p.transform = 'translate(' + iconX + ',' + iconY + ')';
                    return true;
                }
                return false;
            }

            function addLabel(yOffset) {
                if (width && areaWidth >= width + 20) {
                    var labelX = centroid[0];
                    var labelY = centroid[1] + yOffset;
                    var bbox = {
                        minX: labelX - (width / 2) - padding,
                        minY: labelY - (height / 2) - padding,
                        maxX: labelX + (width / 2) + padding,
                        maxY: labelY + (height / 2) + padding
                    };

                    if (tryInsert([bbox], entity.id, true)) {
                        p.x = labelX;
                        p.y = labelY;
                        p.textAnchor = 'middle';
                        p.height = height;
                        return true;
                    }
                }
                return false;
            }
        }


        // force insert a singular bounding box
        // singular box only, no array, id better be unique
        function doInsert(bbox, id) {
            bbox.id = id;

            var oldbox = _entitybboxes[id];
            if (oldbox) {
                _rdrawn.remove(oldbox);
            }
            _entitybboxes[id] = bbox;
            _rdrawn.insert(bbox);
        }

        function undoInsert(id) {
            var oldbox = _entitybboxes[id];
            if (oldbox) {
                _rdrawn.remove(oldbox);
            }
            delete _entitybboxes[id];
        }

        function tryInsert(bboxes, id, saveSkipped) {
            var skipped = false;

            for (var i = 0; i < bboxes.length; i++) {
                var bbox = bboxes[i];
                bbox.id = id;

                // Check that label is visible
                if (bbox.minX < 0 || bbox.minY < 0 || bbox.maxX > dimensions[0] || bbox.maxY > dimensions[1]) {
                    skipped = true;
                    break;
                }
                if (_rdrawn.collides(bbox)) {
                    skipped = true;
                    break;
                }
            }

            _entitybboxes[id] = bboxes;

            if (skipped) {
                if (saveSkipped) {
                    _rskipped.load(bboxes);
                }
            } else {
                _rdrawn.load(bboxes);
            }

            return !skipped;
        }


        var layer = selection.selectAll('.layer-osm.labels');
        layer.selectAll('.labels-group')
            .data(['halo', 'label', 'debug'])
            .enter()
            .append('g')
            .attr('class', function(d) { return 'labels-group ' + d; });

        var halo = layer.selectAll('.labels-group.halo');
        var label = layer.selectAll('.labels-group.label');
        var debug = layer.selectAll('.labels-group.debug');

        // points
        drawPointLabels(label, labelled.point, filter, 'pointlabel');
        drawPointLabels(halo, labelled.point, filter, 'pointlabel-halo');

        // lines
        drawLinePaths(layer, labelled.line, filter, '');
        drawLineLabels(label, labelled.line, filter, 'linelabel');
        drawLineLabels(halo, labelled.line, filter, 'linelabel-halo');

        // areas
        drawAreaLabels(label, labelled.area, filter, 'arealabel');
        drawAreaLabels(halo, labelled.area, filter, 'arealabel-halo');
        drawAreaIcons(label, labelled.area, filter, 'areaicon');
        drawAreaIcons(halo, labelled.area, filter, 'areaicon-halo');

        // debug
        drawCollisionBoxes(debug, _rskipped, 'debug-skipped');
        drawCollisionBoxes(debug, _rdrawn, 'debug-drawn');

        layer.call(filterLabels);
    }


    function filterLabels(selection) {
        var drawLayer = selection.selectAll('.layer-osm.labels');
        var layers = drawLayer.selectAll('.labels-group.halo, .labels-group.label');

        layers.selectAll('.nolabel')
            .classed('nolabel', false);

        var mouse = context.map().mouse();
        var ids = [];
        var pad, bbox;

        // hide labels near the mouse
        if (mouse && context.mode().id !== 'browse' && context.mode().id !== 'select') {
            pad = 20;
            bbox = { minX: mouse[0] - pad, minY: mouse[1] - pad, maxX: mouse[0] + pad, maxY: mouse[1] + pad };
            var nearMouse = _rdrawn.search(bbox).map(function(entity) { return entity.id; });
            ids.push.apply(ids, nearMouse);
        }
        ids = utilArrayDifference(ids, context.mode()?.selectedIDs?.() || []);

        layers.selectAll(utilEntitySelector(ids))
            .classed('nolabel', true);


        // draw the mouse bbox if debugging is on..
        var debug = selection.selectAll('.labels-group.debug');
        var gj = [];
        if (context.getDebug('collision')) {
            gj = bbox ? [{
                type: 'Polygon',
                coordinates: [[
                    [bbox.minX, bbox.minY],
                    [bbox.maxX, bbox.minY],
                    [bbox.maxX, bbox.maxY],
                    [bbox.minX, bbox.maxY],
                    [bbox.minX, bbox.minY]
                ]]
            }] : [];
        }

        var box = debug.selectAll('.debug-mouse')
            .data(gj);

        // exit
        box.exit()
            .remove();

        // enter/update
        box.enter()
            .append('path')
            .attr('class', 'debug debug-mouse yellow')
            .merge(box)
            .attr('d', d3_geoPath());
    }


    var throttleFilterLabels = _throttle(filterLabels, 100);


    drawLabels.observe = function(selection) {
        var listener = function() { throttleFilterLabels(selection); };
        selection.on('mousemove.hidelabels', listener);
        context.on('enter.hidelabels', listener);
    };


    drawLabels.off = function(selection) {
        throttleFilterLabels.cancel();
        selection.on('mousemove.hidelabels', null);
        context.on('enter.hidelabels', null);
    };


    return drawLabels;
}


const _textWidthCache = {};
export function textWidth(text, size, container) {
    let c = _textWidthCache[size];
    if (!c) c = _textWidthCache[size] = {};

    if (c[text]) {
        return c[text];
    }
    const elem = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    elem.style.fontSize = `${size}px`;
    elem.textContent = text;
    container.appendChild(elem);
    c[text] = elem.getComputedTextLength();
    elem.remove();
    return c[text];
}


const nonPrimaryKeys = new Set([
    'check_date',
    'fixme',
    'layer',
    'level',
    'level:ref',
    'note'
]);
const nonPrimaryKeysRegex = /^(ref|survey|note):/;
export function isAddressPoint(tags) {
    const keys = Object.keys(tags);
    return keys.length > 0 && keys.every(key =>
        key.startsWith('addr:') ||
        !osmIsInterestingTag(key) ||
        nonPrimaryKeys.has(key) ||
        nonPrimaryKeysRegex.test(key)
    );
}
