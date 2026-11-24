import Cairo from 'cairo';
import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {WhipPhysics} from './physics.js';

const POINTER_INTERVAL_MS = 8;
const FRAME_INTERVAL_US = 15000;
const SURFACE_TILE_SIZE = 64;
const PAINT_MARGIN = 28;
const CRACK_DURATION = 0.085;
const TOGGLE_SHORTCUT = 'toggle-whip';

function drawCurveSegment(cr, points, index) {
    const start = points[index];
    const end = points[index + 1];
    const before = points[Math.max(1, index - 1)];
    const after = points[Math.min(index + 2, points.length - 1)];

    cr.moveTo(start.x, start.y);
    cr.curveTo(
        start.x + (end.x - before.x) / 6,
        start.y + (end.y - before.y) / 6,
        end.x - (after.x - start.x) / 6,
        end.y - (after.y - start.y) / 6,
        end.x, end.y);
    cr.stroke();
}

function drawLeather(cr, points) {
    const segments = points.length - 2;
    for (const [red, green, blue, width, taper] of [
        [0.10, 0.062, 0.043, 2.5, 6.4],
        [0.63, 0.32, 0.15, 1.4, 5.1],
        [0.97, 0.69, 0.40, 0.6, 1.15],
    ]) {
        cr.setSourceRGB(red, green, blue);
        for (let i = 1; i <= segments; i++) {
            const remaining = 1 - (i - 1) / Math.max(1, segments - 1);
            cr.setLineWidth(width + taper * remaining ** 1.25);
            drawCurveSegment(cr, points, i);
        }
    }
}

function drawGrip(cr, start, end) {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < 1)
        return;

    cr.save();
    cr.translate(start.x, start.y);
    cr.rotate(Math.atan2(end.y - start.y, end.x - start.x));
    for (const [red, green, blue, width] of [
        [0.09, 0.06, 0.05, 13],
        [0.31, 0.16, 0.11, 10],
    ]) {
        cr.setSourceRGB(red, green, blue);
        cr.setLineWidth(width);
        cr.moveTo(2, 0);
        cr.lineTo(length - 1, 0);
        cr.stroke();
    }

    cr.setLineWidth(1.25);
    cr.setSourceRGB(0.54, 0.29, 0.17);
    for (let x = 5; x < length - 4; x += 4) {
        cr.moveTo(x - 2, -3.6);
        cr.lineTo(x + 1, 3.3);
    }
    cr.stroke();

    cr.setSourceRGB(0.96, 0.68, 0.36);
    cr.setLineWidth(2.4);
    for (const x of [1, length - 2]) {
        cr.moveTo(x, -4.3);
        cr.lineTo(x, 4.3);
    }
    cr.stroke();
    cr.restore();
}

function drawCrack(cr, crack, age) {
    const elapsed = (age - crack.age) / CRACK_DURATION;
    const spread = 4 + 11 * elapsed;
    cr.save();
    cr.translate(crack.x, crack.y);
    cr.rotate(crack.angle);
    cr.setSourceRGBA(1, 0.77, 0.46, (1 - elapsed) * 0.88);
    cr.setLineWidth(1.8);
    for (const side of [-1, 1]) {
        cr.moveTo(2 + spread / 2, side * spread / 2);
        cr.lineTo(6 + spread, side * spread);
    }
    cr.stroke();
    cr.restore();
}

export default class LatigoExtension extends Extension {
    enable() {
        this._physics = new WhipPhysics();
        this._settings = this.getSettings();
        this._soundFile = this.dir.get_child('latigazo.oga');
        this._playback = null;
        this._pointerSource = 0;
        this._capturedEvent = 0;
        this._aimMonitor = null;
        this._area = new St.DrawingArea({reactive: false, visible: false});
        this._area.connect('repaint', area => this._paint(area));
        // A nonreactive actor keeps clicks with the window below the drawing.
        Main.layoutManager.uiGroup.add_child(this._area);

        this._indicator = new PanelMenu.Button(0.5, 'Látigo de escritorio', true);
        this._indicator.accessible_role = Atk.Role.TOGGLE_BUTTON;
        const content = new St.BoxLayout({
            style_class: 'latigo-panel-content',
            y_align: Clutter.ActorAlign.CENTER,
        });
        content.add_child(new St.Icon({
            gicon: new Gio.FileIcon({file: this.dir.get_child('latigo-symbolic.svg')}),
            style_class: 'system-status-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        content.add_child(new St.Widget({
            style_class: 'latigo-panel-dot',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._indicator.add_child(content);
        this._indicator.connect('button-release-event', (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            this._toggleArmed();
            return Clutter.EVENT_STOP;
        });
        this._indicator.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            if (key !== Clutter.KEY_space && key !== Clutter.KEY_Return && key !== Clutter.KEY_KP_Enter)
                return Clutter.EVENT_PROPAGATE;
            this._toggleArmed();
            return Clutter.EVENT_STOP;
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
        const shortcut = Main.wm.addKeybinding(TOGGLE_SHORTCUT, this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this._toggleArmed());
        this._shortcutRegistered = shortcut !== Meta.KeyBindingAction.NONE;
        this._setArmed(false);
    }

    disable() {
        if (this._shortcutRegistered) {
            Main.wm.removeKeybinding(TOGGLE_SHORTCUT);
            this._shortcutRegistered = false;
        }
        this._setArmed(false);
        this._indicator?.destroy();
        this._area?.destroy();
        this._indicator = null;
        this._area = null;
        this._physics = null;
        this._aimMonitor = null;
        this._monitors = null;
        this._settings = null;
        this._soundFile = null;
    }

    _toggleArmed() {
        this._setArmed(!this._pointerSource);
    }

    _setArmed(armed) {
        if (armed && !this._pointerSource) {
            const [, , modifiers] = global.get_pointer();
            this._primaryDown = Boolean(modifiers & Clutter.ModifierType.BUTTON1_MASK);
            this._capturedEvent = global.stage.connect('captured-event', (_stage, event) => {
                const type = event.type();
                if (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.BUTTON_RELEASE) {
                    if (event.get_button() === Clutter.BUTTON_PRIMARY) {
                        const [x, y] = event.get_coords();
                        this._updateButton(type === Clutter.EventType.BUTTON_PRESS, x, y);
                    }
                }
                return Clutter.EVENT_PROPAGATE;
            });
            // Wayland can forward app clicks before the stage emits captured-event.
            this._pointerSource = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POINTER_INTERVAL_MS,
                () => this._samplePointer());
            GLib.Source.set_name_by_id(this._pointerSource, '[latigo] sample pointer');
            this._lastFrame = GLib.get_monotonic_time() - FRAME_INTERVAL_US;
            this._samplePointer();
        } else if (!armed && this._pointerSource) {
            GLib.Source.remove(this._pointerSource);
            this._pointerSource = 0;
            global.stage.disconnect(this._capturedEvent);
            this._capturedEvent = 0;
            this._hide();
        }

        if (!this._indicator)
            return;
        this._indicator.accessible_name = armed ? 'Látigo activado' : 'Látigo pausado';
        if (armed) {
            this._indicator.add_style_class_name('latigo-panel-active');
            this._indicator.add_accessible_state(Atk.StateType.CHECKED);
        } else {
            this._indicator.remove_style_class_name('latigo-panel-active');
            this._indicator.remove_accessible_state(Atk.StateType.CHECKED);
        }
    }

    _updateButton(down, x, y) {
        const pressed = down && !this._primaryDown;
        this._primaryDown = down;
        if (!pressed || Main.sessionMode.isLocked || Main.sessionMode.isGreeter)
            return;

        const target = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        if (!target || !this._indicator.contains(target))
            this._strike(x, y);
    }

    _samplePointer() {
        const [x, y, modifiers] = global.get_pointer();
        this._updateButton(Boolean(modifiers & Clutter.ModifierType.BUTTON1_MASK), x, y);
        if (Main.sessionMode.isLocked || Main.sessionMode.isGreeter) {
            if (this._area.visible)
                this._hide();
            return GLib.SOURCE_CONTINUE;
        }

        const now = GLib.get_monotonic_time();
        const elapsed = now - this._lastFrame;
        if (elapsed >= FRAME_INTERVAL_US) {
            this._lastFrame = now;
            const dt = elapsed / 1e6;
            if (this._area.visible && this._physics.active) {
                this._advance(dt, x, y);
            } else {
                const anchor = this._physics.points[0];
                if (!this._area.visible || this._physics.moving || anchor.x !== x || anchor.y !== y ||
                    this._monitors !== Main.layoutManager.monitors)
                    this._follow(dt, x, y);
            }
        }
        return GLib.SOURCE_CONTINUE;
    }

    _aimAt(x, y) {
        this._monitors = Main.layoutManager.monitors;
        const monitor = this._monitors.find(rect =>
            x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height);
        if (!monitor)
            return null;

        const localX = x - monitor.x;
        const localY = y - monitor.y;
        const length = Math.min(350, Math.max(120, Math.min(monitor.width, monitor.height) * 0.47));
        const roomOnBothSides = Math.min(localX, monitor.width - localX) >= length;
        const roomAboveAndBelow = Math.min(localY, monitor.height - localY) >= length * 0.45;
        const sameMonitor = this._aimMonitor === monitor;
        const towardRight = sameMonitor && roomOnBothSides ? this._towardRight : localX < monitor.width / 2;
        const towardDown = sameMonitor && roomAboveAndBelow ? this._towardDown : localY < monitor.height / 2;
        this._aimMonitor = monitor;
        this._towardRight = towardRight;
        this._towardDown = towardDown;

        const horizontal = towardRight ? 1 : -1;
        const relativeY = localY / monitor.height;
        const vertical = Math.max(-0.9, Math.min(0.9, (0.57 - relativeY) * 1.8));
        const direction = Math.atan2(vertical, horizontal);
        const side = towardDown ? horizontal : -horizontal;
        return {direction, length, side};
    }

    _follow(dt, x, y) {
        const aim = this._aimAt(x, y);
        if (!aim)
            return;

        if (this._area.visible)
            this._physics.follow(dt, x, y, aim);
        else
            this._physics.rest(x, y, aim);
        this._render();
    }

    _strike(x, y) {
        const aim = this._aimAt(x, y);
        if (!aim)
            return;

        this._physics.strike(x, y, aim);
        this._crack = null;
        this._lastFrame = GLib.get_monotonic_time();
        this._playback?.cancel();
        this._playback = new Gio.Cancellable();
        global.display.get_sound_player().play_from_file(this._soundFile, 'Latigazo', this._playback);
        this._render();
    }

    _advance(dt, x, y) {
        this._physics.step(dt, x, y);
        if (!this._physics.active) {
            this._crack = null;
            this._follow(dt, x, y);
            return;
        }

        if (this._physics.cracked) {
            const tip = this._physics.points.at(-1);
            const previous = this._physics.points.at(-2);
            this._crack = {
                x: tip.x,
                y: tip.y,
                angle: Math.atan2(tip.y - previous.y, tip.x - previous.x),
                age: this._physics.age,
            };
        } else if (this._crack && this._physics.age - this._crack.age >= CRACK_DURATION) {
            this._crack = null;
        }
        this._render();
    }

    _render() {
        const points = this._physics.points;
        let {x: left, y: top} = points[0];
        let right = left;
        let bottom = top;
        for (const point of this._crack ? [...points, this._crack] : points) {
            left = Math.min(left, point.x);
            right = Math.max(right, point.x);
            top = Math.min(top, point.y);
            bottom = Math.max(bottom, point.y);
        }
        const x = Math.floor((left - PAINT_MARGIN) / SURFACE_TILE_SIZE) * SURFACE_TILE_SIZE;
        const y = Math.floor((top - PAINT_MARGIN) / SURFACE_TILE_SIZE) * SURFACE_TILE_SIZE;
        const width = Math.ceil((right + PAINT_MARGIN - x) / SURFACE_TILE_SIZE) * SURFACE_TILE_SIZE;
        const height = Math.ceil((bottom + PAINT_MARGIN - y) / SURFACE_TILE_SIZE) * SURFACE_TILE_SIZE;

        this._area.set_position(x, y);
        this._area.set_size(width, height);
        this._area.show();
        this._area.queue_repaint();
    }

    _paint(area) {
        const cr = area.get_context();
        try {
            const [x, y] = area.get_position();
            const points = this._physics.points;
            cr.translate(-x, -y);
            cr.setLineCap(Cairo.LineCap.ROUND);
            drawLeather(cr, points);
            drawGrip(cr, points[0], points[1]);
            if (this._crack)
                drawCrack(cr, this._crack, this._physics.age);
        } finally {
            cr.$dispose();
        }
    }

    _hide() {
        this._area?.hide();
        this._crack = null;
        this._playback?.cancel();
        this._playback = null;
    }
}
