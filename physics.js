const STEP = 1 / 240;
const PARTICLE_COUNT = 33;
const GRIP_LENGTH = 23;
const DEFAULT_LENGTH = 290;
const SETTLE_START = 0.51;
const LIFETIME = 0.92;
const MAX_FRAME_TIME = 0.08;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function ease(value) {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
}

function angleDifference(target, current) {
    const difference = target - current;
    return Math.atan2(Math.sin(difference), Math.cos(difference));
}

export class WhipPhysics {
    constructor({length = DEFAULT_LENGTH} = {}) {
        this._defaultLength = length;
        this.points = Array.from({length: PARTICLE_COUNT}, (_, index) => {
            const taper = 1 - index / (PARTICLE_COUNT - 1);
            return {
                x: 0,
                y: 0,
                previousX: 0,
                previousY: 0,
                angle: 0,
                angularVelocity: 0,
                inverseMass: index < 2 ? 0 : 1 / (0.15 + 1.05 * taper ** 2),
            };
        });
        this.rest(0, 0);
    }

    _resetMotion() {
        this.active = false;
        this.moving = false;
        this.cracked = false;
        this.tipSpeed = 0;
        this.age = 0;
        this._time = 0;
        this._accumulator = 0;
        this._returnAngles = null;
        this._didCrack = false;
        this._cursorVelocityX = 0;
        this._cursorVelocityY = 0;
    }

    _setAim({direction = 0.35, length = this._defaultLength, side = 1} = {}) {
        this._direction = direction;
        this._side = side < 0 ? -1 : 1;
        this._targetLength = clamp(length, 80, 450);
    }

    _setLength(length) {
        this._length = length;
        this._segmentLength = (length - GRIP_LENGTH) / (PARTICLE_COUNT - 2);
    }

    rest(x, y, aim) {
        this._resetMotion();
        this._setAim(aim);
        this._setLength(this._targetLength);
        this._placeRestPose(x, y);
        this._historyTime = STEP;
        for (const point of this.points) {
            point.previousX = point.x;
            point.previousY = point.y;
        }
    }

    strike(x, y, aim) {
        this._resetMotion();
        this._setAim(aim);
        const [anchor, grip] = this.points;
        this._startRotation = angleDifference(Math.atan2(grip.y - anchor.y, grip.x - anchor.x),
            this._restAngle(1));

        // Preserve the rope's shape and velocity at the instant of the click.
        const dx = x - anchor.x;
        const dy = y - anchor.y;
        const gripX = grip.x;
        const gripY = grip.y;
        const previousGripX = grip.previousX;
        const previousGripY = grip.previousY;
        const scale = (this._targetLength - GRIP_LENGTH) / (this._length - GRIP_LENGTH);
        const historyScale = Math.min(1, STEP / this._historyTime);
        for (let index = 0; index < this.points.length; index++) {
            const point = this.points[index];
            const stretch = index < 2 ? 0 : scale - 1;
            point.x += dx + (point.x - gripX) * stretch;
            point.y += dy + (point.y - gripY) * stretch;
            const previousX = point.previousX + dx + (point.previousX - previousGripX) * stretch;
            const previousY = point.previousY + dy + (point.previousY - previousGripY) * stretch;
            point.previousX = point.x + (previousX - point.x) * historyScale;
            point.previousY = point.y + (previousY - point.y) * historyScale;
        }
        this._x = x;
        this._y = y;
        this._setLength(this._targetLength);
        this._historyTime = STEP;
        this.active = true;
    }

    follow(dt, x, y, aim) {
        if (!Number.isFinite(dt) || dt <= 0)
            return;

        const dx = x - this._x;
        const dy = y - this._y;
        // A jump between distant pointer positions should not throw the rope off screen.
        if (dx * dx + dy * dy > 180 ** 2) {
            this.rest(x, y, aim);
            return;
        }

        this._setAim(aim);
        const frameTime = Math.min(dt, MAX_FRAME_TIME);
        const response = 1 - Math.exp(-25 * frameTime);
        this._cursorVelocityX += (dx / dt - this._cursorVelocityX) * response;
        this._cursorVelocityY += (dy / dt - this._cursorVelocityY) * response;
        this._setLength(this._length + (this._targetLength - this._length) * response);

        const substeps = Math.ceil(frameTime / STEP);
        const step = frameTime / substeps;
        let moving = Math.hypot(this._cursorVelocityX, this._cursorVelocityY) > 1 ||
            Math.abs(this._targetLength - this._length) > 0.08;
        for (let index = 1; index < this.points.length; index++) {
            const point = this.points[index];
            const progress = (index - 1) / (this.points.length - 2);
            const restAngle = this._restAngle(index);
            const sidewaysSpeed = this._cursorVelocityX * Math.sin(restAngle) -
                this._cursorVelocityY * Math.cos(restAngle);
            const drag = (0.08 + 0.46 * Math.sqrt(progress)) * Math.tanh(sidewaysSpeed / 580);
            const target = restAngle + drag;
            // The grip responds first. The lighter links toward the tip trail and overshoot it.
            const frequency = 25 - 11 * progress;
            for (let i = 0; i < substeps; i++) {
                const spring = frequency ** 2 * angleDifference(target, point.angle);
                const damping = 1.2 * frequency * point.angularVelocity;
                point.angularVelocity += (spring - damping) * step;
                point.angle += point.angularVelocity * step;
            }
            moving ||= Math.abs(angleDifference(restAngle, point.angle)) > 0.001 ||
                Math.abs(point.angularVelocity) > 0.012;
        }

        this.moving = moving;
        this._historyTime = dt;
        if (moving) {
            this._placeLinks(x, y);
        } else {
            this._setLength(this._targetLength);
            this._placeRestPose(x, y);
        }
    }

    _restAngle(index) {
        const gripAngle = this._direction - 0.9 * this._side;
        return index === 1 ? gripAngle : this._flexAngle(index, gripAngle, 0.18);
    }

    _placeRestPose(x, y, blend = 1) {
        for (let index = 1; index < this.points.length; index++) {
            const point = this.points[index];
            const target = this._restAngle(index);
            point.angle = target;
            if (blend < 1) {
                const start = this._returnAngles[index - 1];
                point.angle = start + angleDifference(target, start) * blend;
            }
            point.angularVelocity = 0;
        }
        this._placeLinks(x, y);
    }

    _placeLinks(x, y) {
        this._x = x;
        this._y = y;
        const anchor = this.points[0];
        anchor.previousX = anchor.x;
        anchor.previousY = anchor.y;
        anchor.x = x;
        anchor.y = y;
        for (let index = 1; index < this.points.length; index++) {
            const length = index === 1 ? GRIP_LENGTH : this._segmentLength;
            const previous = this.points[index - 1];
            const point = this.points[index];
            point.previousX = point.x;
            point.previousY = point.y;
            point.x = previous.x + Math.cos(point.angle) * length;
            point.y = previous.y + Math.sin(point.angle) * length;
        }
    }

    step(dt, x = this._x, y = this._y) {
        this.cracked = false;
        if (!this.active || !Number.isFinite(dt) || dt <= 0)
            return;

        const motionTime = Math.min(dt, SETTLE_START - this.age);
        this.age = Math.min(this.age + dt, LIFETIME);
        if (motionTime > 0)
            this._simulate(Math.min(motionTime, MAX_FRAME_TIME), x, y);

        if (this.age >= SETTLE_START) {
            this._returnAngles ??= this.points.slice(1).map((point, index) => {
                const previous = this.points[index];
                return Math.atan2(point.y - previous.y, point.x - previous.x);
            });

            const blend = ease((this.age - SETTLE_START) / (LIFETIME - SETTLE_START));
            this._placeRestPose(x, y, blend);
            this._historyTime = dt;
            this.active = this.age < LIFETIME;
        }
    }

    _simulate(frameTime, x, y) {
        this._accumulator += frameTime;
        const dx = x - this._x;
        const dy = y - this._y;
        if (dx * dx + dy * dy > 180 ** 2) {
            for (const point of this.points) {
                point.x += dx;
                point.y += dy;
                point.previousX += dx;
                point.previousY += dy;
            }
            this._x = x;
            this._y = y;
        }

        while (this._accumulator + 1e-9 >= STEP) {
            this._accumulator = Math.max(0, this._accumulator - STEP);
            this._time += STEP;
            const progress = clamp(1 - this._accumulator / frameTime, 0, 1);
            this._integrate(this._x + (x - this._x) * progress, this._y + (y - this._y) * progress);
        }
        this._x = x;
        this._y = y;
        this._pinGrip(x, y);
    }

    _gripAngle(time) {
        const backswing = 0.48 * ease(time / 0.08);
        const forward = 1.88 * ease((time - 0.08) / 0.17);
        const rebound = 0.56 * ease((time - 0.25) / 0.15);
        const settle = 0.68 * ease((time - 0.4) / 0.2);
        const start = this._startRotation * (1 - ease(time / 0.12));
        return this._direction + this._side * (-0.9 - backswing + forward - rebound + settle) + start;
    }

    _flexAngle(index, gripAngle, wave) {
        const progress = (index - 1) / (PARTICLE_COUNT - 2);
        const flex = ease((progress - wave) / 0.48);
        const wrist = (gripAngle - this._direction) * (1 - progress) ** 3;
        return this._direction + wrist + this._side * (0.28 * Math.sin(progress * Math.PI) + 2.93 * flex);
    }

    _pinGrip(x, y) {
        const angle = this._gripAngle(this._time);
        this.points[0].x = x;
        this.points[0].y = y;
        this.points[1].x = x + Math.cos(angle) * GRIP_LENGTH;
        this.points[1].y = y + Math.sin(angle) * GRIP_LENGTH;
    }

    _integrate(x, y) {
        const lastIndex = this.points.length - 1;
        const tip = this.points[lastIndex];
        const tipX = tip.x;
        const tipY = tip.y;
        const grip = this.points[1];
        const gripX = grip.x;
        const gripY = grip.y;
        this._pinGrip(x, y);

        const angle = this._gripAngle(this._time);
        const phase = clamp((this._time - 0.07) / 0.25, 0, 1);
        const wave = 0.18 + 0.78 * phase ** 1.35;
        // The short wrist impulse guides a moving bend. Inertia and gravity take over as it releases.
        const drive = 0.075 * (1 - ease((this._time - 0.29) / 0.08));
        let guideX = grip.x;
        let guideY = grip.y;
        for (let index = 2; index <= lastIndex; index++) {
            const point = this.points[index];
            const damping = 0.994 - 0.009 * index / lastIndex - drive;
            const dx = (point.x - point.previousX) * damping;
            const dy = (point.y - point.previousY) * damping;
            point.previousX = point.x;
            point.previousY = point.y;
            point.x += dx;
            point.y += dy + 340 * STEP ** 2;

            if (drive > 0) {
                const flexAngle = this._flexAngle(index, angle, wave);
                guideX += Math.cos(flexAngle) * this._segmentLength;
                guideY += Math.sin(flexAngle) * this._segmentLength;
                point.x += (guideX - point.x) * drive;
                point.y += (guideY - point.y) * drive;
            }
        }

        const neck = this.points[2];
        const targetX = grip.x + Math.cos(angle) * this._segmentLength;
        const targetY = grip.y + Math.sin(angle) * this._segmentLength;
        neck.x += (targetX - neck.x) * 0.62;
        neck.y += (targetY - neck.y) * 0.62;

        for (let iteration = 0; iteration < 7; iteration++) {
            for (let index = lastIndex - 1; index >= 1; index--)
                this._keepDistance(index, index + 1, this._segmentLength, 1);

            for (let index = 1; index < lastIndex; index++) {
                if (index + 2 <= lastIndex) {
                    const flexibility = 1 - index / lastIndex;
                    this._keepDistance(index, index + 2, this._segmentLength * 1.95, 0.05 + 0.39 * flexibility ** 2);
                }
                this._keepDistance(index, index + 1, this._segmentLength, 1);
            }
        }

        const gripDeltaX = grip.x - gripX;
        const gripDeltaY = grip.y - gripY;
        this.tipSpeed = Math.hypot(tip.x - tipX - gripDeltaX, tip.y - tipY - gripDeltaY) / STEP;
        const reach = Math.hypot(tip.x - x, tip.y - y);
        const straightening = reach > this._length * 0.90 && this.tipSpeed > this._length * 3.4;
        if (!this._didCrack && this._time >= 0.24 && (straightening || this._time >= 0.29)) {
            this._didCrack = true;
            this.cracked = true;
        }
    }

    _keepDistance(from, to, targetLength, strength) {
        const a = this.points[from];
        const b = this.points[to];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance < 0.0001)
            return;

        const correction = strength * (distance - targetLength) / (distance * (a.inverseMass + b.inverseMass));
        const correctionX = dx * correction;
        const correctionY = dy * correction;
        a.x += a.inverseMass * correctionX;
        a.y += a.inverseMass * correctionY;
        b.x -= b.inverseMass * correctionX;
        b.y -= b.inverseMass * correctionY;
    }
}
