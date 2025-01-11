// ==========================================
// Player
//
// This class contains the code that manages the local player.
// ==========================================

// Mouse event enumeration
const MOUSE = {
	DOWN: 1,
	UP: 2,
	MOVE: 3,
};

import { Vector, rectRectCollide, lineRectCollide } from './helpers.js'; // Ensure Vector, rectRectCollide, and lineRectCollide are imported
import { BLOCK } from './blocks.js'; // Ensure BLOCK is imported

const MOVEMENT = {
    WALK_SPEED: 4.0,         // Reduced from 5.5
    SPRINT_SPEED: 6.5,       // Reduced from 9.0
    JUMP_FORCE: 8.0,         // Reduced from 10.0
    GRAVITY: -20.0,          // Reduced from -32.0
    TERMINAL_VELOCITY: -30.0, // Reduced from -40.0
    AIR_CONTROL: 0.2,        // Reduced from 0.3
    GROUND_FRICTION: 0.9,    // Increased from 0.85
    AIR_FRICTION: 0.98,      // Increased from 0.95
    CAMERA_SMOOTHING: 0.15,  // Add camera smoothing
    MOUSE_SENSITIVITY: 0.003, // Add mouse sensitivity
    MAX_PITCH: Math.PI * 0.495 // Prevent camera from flipping
};

export class Player {
    constructor() {
        this.pos = null;
        this.velocity = new Vector(0, 0, 0);
        this.angles = [0, Math.PI, 0];
        this.falling = false;
        this.keys = {
            'f1': false,
            'shift': false,
            'w': false,
            's': false,
            'a': false,
            'd': false,
            ' ': false,
            't': false  // Add chat key
        };
        
        // Add state management
        this.state = {
            lastKeyPress: 0,
            keyCooldown: 200,  // ms between key toggles
            lastXrayToggle: 0,
            xrayCooldown: 250  // ms between xray toggles
        };
        this.physicsState = {
            onGround: false,
            wasOnGround: false,
            jumpQueued: false,
            coyoteTime: 0,
            jumpGracePeriod: 0.1, // seconds
            lastGroundTime: 0
        };
        this.isSprinting = false; // Add sprint state
        this.rentgenView = false;
        this.originalBlocks = null; // Store original blocks when in rentgen mode
        this.xrayCache = {
            active: false,
            blocks: new Map(),
            lastToggle: 0,
            radius: 16, // Visible radius around player
            cooldown: 250 // ms between toggles
        };
        this.keyMap = {
            'Space': ' ',
            'ShiftLeft': 'shift',
            'ShiftRight': 'shift',
            'KeyW': 'w',
            'KeyA': 'a',
            'KeyS': 's',
            'KeyD': 'd',
            'KeyT': 't',
            'F1': 'f1'
        };
        this.movement = {
            maxSpeed: MOVEMENT.WALK_SPEED,
            acceleration: 0.8,
            airAcceleration: 0.2,
            friction: 0.9,
            airFriction: 0.95,
            jumpCooldown: 250, // ms
            lastJump: 0
        };

        // Add camera state
        this.camera = {
            pitch: 0,
            yaw: Math.PI,
            targetPitch: 0,
            targetYaw: Math.PI,
            smoothing: MOVEMENT.CAMERA_SMOOTHING
        };
    }

    update() {
        if (!this.pos || !this.world) return;
        
        try {
            const now = performance.now();
            const delta = this.lastUpdate ? (now - this.lastUpdate) / 1000 : 0.016;
            this.lastUpdate = now;

            // Update camera angles with smoothing
            this.camera.pitch += (this.camera.targetPitch - this.camera.pitch) * this.camera.smoothing;
            this.camera.yaw += (this.camera.targetYaw - this.camera.yaw) * this.camera.smoothing;
            
            // Clamp pitch to prevent camera flipping
            this.camera.pitch = Math.max(-MOVEMENT.MAX_PITCH, Math.min(MOVEMENT.MAX_PITCH, this.camera.pitch));
            
            // Update player angles from camera
            this.angles[0] = this.camera.pitch;
            this.angles[1] = this.camera.yaw;

            // Handle sprinting speed
            this.isSprinting = this.keys["shift"] && this.keys["w"];
            this.movement.maxSpeed = this.isSprinting ? MOVEMENT.SPRINT_SPEED : MOVEMENT.WALK_SPEED;

            // Update physics state
            const onGround = !this.falling;
            this.physicsState.onGround = onGround;
            
            // Apply movement forces with improved air control
            const walkVelocity = this.calculateWalkVelocity();
            if (walkVelocity.length() > 0) {
                const acceleration = onGround ? 1.0 : MOVEMENT.AIR_CONTROL;
                this.velocity.x += walkVelocity.x * acceleration;
                this.velocity.y += walkVelocity.y * acceleration;
            }

            // Apply friction with delta time
            const friction = onGround ? MOVEMENT.GROUND_FRICTION : MOVEMENT.AIR_FRICTION;
            this.velocity.x *= Math.pow(friction, delta * 60);
            this.velocity.y *= Math.pow(friction, delta * 60);

            // Clamp horizontal velocity
            const horizontalSpeed = Math.sqrt(this.velocity.x * this.velocity.x + this.velocity.y * this.velocity.y);
            if (horizontalSpeed > this.movement.maxSpeed) {
                const scale = this.movement.maxSpeed / horizontalSpeed;
                this.velocity.x *= scale;
                this.velocity.y *= scale;
            }

            // Handle jumping with cooldown
            if (this.keys[" "] && onGround && now - this.movement.lastJump > this.movement.jumpCooldown) {
                this.velocity.z = MOVEMENT.JUMP_FORCE;
                this.falling = true;
                this.movement.lastJump = now;
            }

            // Apply gravity with proper delta time
            if (!onGround) {
                this.velocity.z = Math.max(
                    this.velocity.z + MOVEMENT.GRAVITY * delta,
                    MOVEMENT.TERMINAL_VELOCITY
                );
            }

            // Update position with proper collision handling
            const targetPos = this.pos.add(this.velocity.mul(delta));
            const bPos = new Vector(
                Math.floor(this.pos.x),
                Math.floor(this.pos.y),
                Math.floor(this.pos.z)
            );
            this.pos = this.resolveCollision(
                this.pos,
                bPos,
                this.velocity.mul(delta)
            );

            // Update X-ray if active - with error handling
            if (this.xrayCache.active) {
                try {
                    this.enableXray();
                } catch (error) {
                    console.warn("Error updating X-ray:", error);
                    this.xrayCache.active = false;  // Disable on error
                }
            }

            // Store previous state
            this.physicsState.wasOnGround = onGround;
        } catch (error) {
            console.error("Error in player update:", error);
        }
    }

    calculateWalkVelocity() {
        const walkVelocity = new Vector(0, 0, 0);
        const angle = Math.PI - this.camera.yaw; // Use camera yaw instead of angles
        
        // Get raw input
        let dx = 0, dy = 0;
        
        // Directly check key states
        if (this.keys["w"]) dy -= 1;
        if (this.keys["s"]) dy += 1;
        if (this.keys["a"]) dx += 1;
        if (this.keys["d"]) dx -= 1;
        
        // Normalize movement vector
        const length = Math.sqrt(dx * dx + dy * dy);
        if (length > 0) {
            dx /= length;
            dy /= length;
            
            // Apply base movement speed
            const baseSpeed = this.isSprinting ? MOVEMENT.SPRINT_SPEED : MOVEMENT.WALK_SPEED;
            dx *= baseSpeed;
            dy *= baseSpeed;
            
            // Rotate by view angle and apply to velocity
            walkVelocity.x = dx * Math.cos(angle) - dy * Math.sin(angle);
            walkVelocity.y = dx * Math.sin(angle) + dy * Math.cos(angle);
        }
        
        return walkVelocity;
    }

    onKeyEvent(e, down) {
        // Don't process keys when typing in input elements
        if (e.target.tagName === 'INPUT') return;

        const now = performance.now();
        const mappedKey = this.keyMap[e.code];
        
        if (!mappedKey) return;

        // Handle F1 for X-ray toggle
        if (e.code === 'F1') {
            if (down && now - this.xrayCache.lastToggle > this.xrayCache.cooldown) {
                // Directly toggle xray state
                this.xrayCache.active = !this.xrayCache.active;
                if (this.xrayCache.active) {
                    this.enableXray();
                } else {
                    this.disableXray();
                }
                this.xrayCache.lastToggle = now;
            }
            e.preventDefault();
            return;
        }

        // Handle chat key
        if (e.code === 'KeyT' && !down) {
            if (this.eventHandlers?.openChat) {
                this.eventHandlers.openChat();
                e.preventDefault();
                return;
            }
        }

        // Update key state for movement and action keys
        this.keys[mappedKey] = down;
        
        // Prevent default for game control keys
        if (mappedKey in this.keys) {
            e.preventDefault();
        }
    }

    toggleXray() {
        this.xrayCache.active = !this.xrayCache.active;
        
        if (this.xrayCache.active) {
            this.enableXray();
        } else {
            this.disableXray();
        }
    }

    enableXray() {
        const world = this.world;
        if (!world) return;

        console.log("Enabling X-ray mode at", this.pos);

        // Get renderer from canvas correctly
        const renderer = this.canvas?.getContext('webgl') || this.canvas?.getContext('experimental-webgl');
        
        console.log("Canvas and renderer:", {
            canvas: this.canvas,
            renderer: renderer,
            worldRenderer: world.renderer,
            methods: renderer ? Object.getOwnPropertyNames(Object.getPrototypeOf(renderer)) : []
        });

        // Clear previous cache
        this.xrayCache.blocks.clear();

        // Get player position
        const px = Math.floor(this.pos.x);
        const py = Math.floor(this.pos.y);
        const pz = Math.floor(this.pos.z);
        const radius = this.xrayCache.radius;

        let modifiedCount = 0;

        // Process blocks with safety checks
        for (let x = px - radius; x <= px + radius; x++) {
            for (let y = py - radius; y <= py + radius; y++) {
                for (let z = pz - radius; z <= pz + radius; z++) {
                    if (!world.isInBounds(x, y, z)) continue;

                    const block = world.getBlock(x, y, z);
                    if (!block || !block.id || block.id === BLOCK.AIR.id) continue;

                    //console.log("Processing block:", x, y, z, block); // Debug log

                    // Store original block with deep clone
                    const originalBlock = JSON.parse(JSON.stringify(block));
                    this.xrayCache.blocks.set(`${x},${y},${z}`, originalBlock);
                    
                    // Create semi-transparent version
                    const xrayBlock = {
                        ...originalBlock,
                        transparent: true,
                        opacity: 0.3,
                        xray: true,
                        renderAlways: true
                    };
                    
                    try {
                        world.setBlock(x, y, z, xrayBlock);
                        modifiedCount++;
                    } catch (error) {
                        console.error("Error setting block:", error);
                    }
                }
            }
        }

        console.log(`Modified ${modifiedCount} blocks for X-ray`);

        // Try to trigger a render update through multiple methods
        try {
            // Try world's chunk update method first
            if (typeof world.updateChunks === 'function') {
                console.log("Using world.updateChunks()");
                world.updateChunks();
            }
            
            // Try direct renderer methods
            if (world.renderer) {
                if (typeof world.renderer.update === 'function') {
                    console.log("Using renderer.update()");
                    world.renderer.update();
                }
                if (typeof world.renderer.render === 'function') {
                    console.log("Using renderer.render()");
                    world.renderer.render();
                }
                if (typeof world.renderer.draw === 'function') {
                    console.log("Using renderer.draw()");
                    world.renderer.draw();
                }
            }

            // Force a redraw of the canvas
            if (this.canvas) {
                this.canvas.style.display = 'none';
                this.canvas.offsetHeight; // Trigger reflow
                this.canvas.style.display = '';
            }

        } catch (error) {
            console.error("Error updating view:", error);
        }
    }

    disableXray() {
        const world = this.world;
        if (!world) return;

        console.log("Disabling X-ray mode");

        // Get renderer from canvas or world
        const renderer = this.canvas?.renderer || world.renderer;

        // Restore all modified blocks
        for (const [coords, block] of this.xrayCache.blocks) {
            const [x, y, z] = coords.split(',').map(Number);
            world.setBlock(x, y, z, block);
        }

        // Clear cache
        this.xrayCache.blocks.clear();

        // Try all possible render update methods
        try {
            if (renderer) {
                if (typeof renderer.dirty === 'function') renderer.dirty();
                if (typeof renderer.update === 'function') renderer.update();
                if (typeof renderer.render === 'function') renderer.render();
            }
            if (typeof world.updateChunks === 'function') world.updateChunks();
        } catch (error) {
            console.error("Error updating renderer:", error);
        }
    }

    toggleRentgenView() {
        this.rentgenView = !this.rentgenView;
        
        if (this.rentgenView) {
            // Store current blocks and make solid blocks semi-transparent
            this.showCaves();
        } else {
            // Restore original blocks
            this.hideCaves();
        }
    }

    showCaves() {
        const world = this.world;
        this.originalBlocks = new Map();

        // Make solid blocks semi-transparent
        for (let x = 0; x < world.sx; x++) {
            for (let y = 0; y < world.sy; y++) {
                for (let z = 0; z < world.sz; z++) {
                    const block = world.getBlock(x, y, z);
                    if (block && !block.transparent && block.id !== BLOCK.BEDROCK.id) {
                        this.originalBlocks.set(`${x},${y},${z}`, block);
                        
                        // Create semi-transparent version of the block
                        const rentgenBlock = { 
                            ...block,
                            transparent: true,
                            opacity: 0.3,
                            rentgenView: true
                        };
                        
                        world.setBlock(x, y, z, rentgenBlock);
                    }
                }
            }
        }

        // Force a full render update if renderer exists
        if (world.renderer) {
            try {
                // Try different methods to trigger a render update
                if (typeof world.renderer.dirty === 'function') {
                    world.renderer.dirty();
                } else if (typeof world.renderer.update === 'function') {
                    world.renderer.update();
                } else if (typeof world.renderer.render === 'function') {
                    world.renderer.render();
                }
            } catch (error) {
                console.warn('Could not update renderer:', error);
            }
        }
    }

    hideCaves() {
        const world = this.world;
        
        // Restore original blocks
        if (this.originalBlocks) {
            for (const [coords, block] of this.originalBlocks) {
                const [x, y, z] = coords.split(',').map(Number);
                world.setBlock(x, y, z, block);
            }
            this.originalBlocks = null;

            // Force a full render update if renderer exists
            if (world.renderer) {
                try {
                    // Try different methods to trigger a render update
                    if (typeof world.renderer.dirty === 'function') {
                        world.renderer.dirty();
                    } else if (typeof world.renderer.update === 'function') {
                        world.renderer.update();
                    } else if (typeof world.renderer.render === 'function') {
                        world.renderer.render();
                    }
                } catch (error) {
                    console.warn('Could not update renderer:', error);
                }
            }
        }
    }

    // Clean up rentgen view on world change or disconnect
    cleanup() {
        if (this.rentgenView) {
            this.hideCaves();
        }
        this.rentgenView = false;
        this.originalBlocks = null;

        // Ensure X-ray is disabled when changing worlds
        if (this.xrayCache.active) {
            this.disableXray();
        }
        this.xrayCache.active = false;
        this.xrayCache.blocks.clear();
        this.keys['f1'] = false; // Reset F1 state
        // Reset all key states
        Object.keys(this.keys).forEach(key => this.keys[key] = false);

        // Reset all states
        this.state.lastKeyPress = 0;
        this.state.lastXrayToggle = 0;
        
        // Reset all movement states
        this.isSprinting = false;
        this.falling = false;
        this.physicsState.onGround = false;
        this.physicsState.wasOnGround = false;
        this.physicsState.jumpQueued = false;
        
        // Clear all keys
        Object.keys(this.keys).forEach(key => this.keys[key] = false);
    }

    // ...existing code...
}

// setWorld( world )
//
// Assign the local player to a world.

Player.prototype.setWorld = function (world) {
    console.log("Setting player world...");
	this.world = world;
	this.world.localPlayer = this;
    // Create new Vector for spawn point if needed
    const spawnPoint = this.world.spawnPoint instanceof Vector ? 
        this.world.spawnPoint : 
        new Vector(this.world.spawnPoint.x, this.world.spawnPoint.y, this.world.spawnPoint.z);
    this.pos = spawnPoint;
	this.velocity = new Vector(0, 0, 0);
	this.angles = [0, Math.PI, 0];
	this.falling = false;
	this.keys = {
        'f1': false,
        'shift': false,
        'w': false,
        's': false,
        'a': false,
        'd': false,
        ' ': false,
        't': false
    };
    this.state = {
        lastKeyPress: 0,
        keyCooldown: 200,
        lastXrayToggle: 0,
        xrayCooldown: 250
    };
	this.buildMaterial = BLOCK.DIRT;
	this.eventHandlers = {};
    console.log("Player world set:", this.world);
};

// setClient( client )
//
// Assign the local player to a socket client.

Player.prototype.setClient = function (client) {
	this.client = client;
};

// setInputCanvas( id )
//
// Set the canvas the renderer uses for some input operations.

Player.prototype.setInputCanvas = function (id) {
	const canvas = (this.canvas = document.getElementById(id));

	document.onkeydown = (e) => {
		if (e.target.tagName !== "INPUT") {
			this.onKeyEvent(e, true);
			return false;
		}
	};
	document.onkeyup = (e) => {
		if (e.target.tagName !== "INPUT") {
			this.onKeyEvent(e, false);
			return false;
		}
	};
	canvas.onmousedown = (e) => {
		this.onMouseEvent(e.clientX, e.clientY, MOUSE.DOWN, e.which === 3);
		return false;
	};
	canvas.onmouseup = (e) => {
		this.onMouseEvent(e.clientX, e.clientY, MOUSE.UP, e.which === 3);
		return false;
	};
	canvas.onmousemove = (e) => {
		this.onMouseEvent(e.clientX, e.clientY, MOUSE.MOVE, e.which === 3);
		return false;
	};
};

// setMaterialSelector( id )
//
// Sets the table with the material selectors.

Player.prototype.setMaterialSelector = function (id) {
	const tableRow = document.getElementById(id).getElementsByTagName("tr")[0];
	let texOffset = 0;
	this.prevSelector = null; // Initialize prevSelector

	for (const mat in BLOCK) {
		if (typeof BLOCK[mat] === "object" && BLOCK[mat].spawnable) {
			const selector = document.createElement("td");
			selector.style.backgroundPosition = `${texOffset}px 0px`;

			selector.material = BLOCK[mat];
			selector.onclick = function () {
				this.style.opacity = "1.0";

				if (this.prevSelector) {
					this.prevSelector.style.opacity = null;
				}
				this.prevSelector = this;

				this.buildMaterial = this.material;
			}.bind(this);

			if (mat === "DIRT") {
				this.prevSelector = selector;
				selector.style.opacity = "1.0";
			}

			tableRow.appendChild(selector);
			texOffset -= 70;
		}
	}
};

// on( event, callback )
//
// Hook a player event.

Player.prototype.on = function (event, callback) {
	this.eventHandlers[event] = callback;
};

// onMouseEvent( x, y, type, rmb )
//
// Hook for mouse input.

Player.prototype.onMouseEvent = function (x, y, type, rmb) {
	if (type === MOUSE.DOWN) {
		this.dragStart = { x, y };
		this.mouseDown = true;
		this.camera.startYaw = this.camera.targetYaw;
		this.camera.startPitch = this.camera.targetPitch;
	} else if (type === MOUSE.UP) {
		if (Math.abs(this.dragStart.x - x) + Math.abs(this.dragStart.y - y) < 4) {
			this.doBlockAction(x, y, !rmb);
		}
		this.dragging = false;
		this.mouseDown = false;
		this.canvas.style.cursor = "default";
	} else if (type === MOUSE.MOVE && this.mouseDown) {
		this.dragging = true;
		
		// Update camera angles with sensitivity
		this.camera.targetPitch = this.camera.startPitch - (y - this.dragStart.y) * MOVEMENT.MOUSE_SENSITIVITY;
		this.camera.targetYaw = this.camera.startYaw + (x - this.dragStart.x) * MOVEMENT.MOUSE_SENSITIVITY;

		// Clamp pitch immediately for target value
		this.camera.targetPitch = Math.max(-MOVEMENT.MAX_PITCH, Math.min(MOVEMENT.MAX_PITCH, this.camera.targetPitch));
		
		this.canvas.style.cursor = "move";
	}
};

// doBlockAction( x, y )
//
// Called to perform an action based on the player's block selection and input.

Player.prototype.doBlockAction = function (x, y, destroy) {
	const bPos = new Vector(Math.floor(this.pos.x), Math.floor(this.pos.y), Math.floor(this.pos.z));
	const block = this.canvas.renderer.pickAt(
		new Vector(bPos.x - 4, bPos.y - 4, bPos.z - 4),
		new Vector(bPos.x + 4, bPos.y + 4, bPos.z + 4),
		x,
		y
	);

	if (block !== false) {
		const obj = this.client ? this.client : this.world;

		if (destroy) obj.setBlock(block.x, block.y, block.z, BLOCK.AIR);
		else obj.setBlock(block.x + block.n.x, block.y + block.n.y, block.z + block.n.z, this.buildMaterial);
	}
};

// getEyePos()
//
// Returns the position of the eyes of the player for rendering.

Player.prototype.getEyePos = function () {
	return this.pos.add(new Vector(0.0, 0.0, 1.7));
};

// resolveCollision( pos, bPos, velocity )
//
// Resolves collisions between the player and blocks on XY level for the next movement step.

Player.prototype.resolveCollision = function (pos, bPos, velocity) {
    if (!this.world.isInBounds(bPos.x, bPos.y, bPos.z)) {
        // Create new Vector for spawn point if needed
        const spawnPoint = this.world.spawnPoint instanceof Vector ? 
            this.world.spawnPoint : 
            new Vector(this.world.spawnPoint.x, this.world.spawnPoint.y, this.world.spawnPoint.z);
        
        this.pos = spawnPoint;
        this.velocity = new Vector(0, 0, 0);
        return this.pos;
    }

	const world = this.world;
	const playerRect = { x: pos.x + velocity.x, y: pos.y + velocity.y, size: 0.25 };

	// Collect XY collision sides
	let collisionCandidates = [];

	for (let x = bPos.x - 1; x <= bPos.x + 1; x++) {
		for (let y = bPos.y - 1; y <= bPos.y + 1; y++) {
			for (let z = bPos.z; z <= bPos.z + 1; z++) {
				if (world.getBlock(x, y, z) !== BLOCK.AIR) {
					if (world.getBlock(x - 1, y, z) === BLOCK.AIR) collisionCandidates.push({ x, dir: -1, y1: y, y2: y + 1 });
					if (world.getBlock(x + 1, y, z) === BLOCK.AIR) collisionCandidates.push({ x: x + 1, dir: 1, y1: y, y2: y + 1 });
					if (world.getBlock(x, y - 1, z) === BLOCK.AIR) collisionCandidates.push({ y, dir: -1, x1: x, x2: x + 1 });
					if (world.getBlock(x, y + 1, z) === BLOCK.AIR) collisionCandidates.push({ y: y + 1, dir: 1, x1: x, x2: x + 1 });
				}
			}
		}
	}

	// Solve XY collisions
	for (const side of collisionCandidates) {
		if (lineRectCollide(side, playerRect)) {
			if (side.x != null && velocity.x * side.dir < 0) {
				pos.x = side.x + (playerRect.size / 2) * (velocity.x > 0 ? -1 : 1);
				velocity.x = 0;
			} else if (side.y != null && velocity.y * side.dir < 0) {
				pos.y = side.y + (playerRect.size / 2) * (velocity.y > 0 ? -1 : 1);
				velocity.y = 0;
			}
		}
	}

	const playerFace = { x1: pos.x + velocity.x - 0.125, y1: pos.y + velocity.y - 0.125, x2: pos.x + velocity.x + 0.125, y2: pos.y + velocity.y + 0.125 };
	const newBZLower = Math.floor(pos.z + velocity.z);
	const newBZUpper = Math.floor(pos.z + 1.7 + velocity.z * 1.1);

	// Collect Z collision sides
	collisionCandidates = [];

	for (let x = bPos.x - 1; x <= bPos.x + 1; x++) {
		for (let y = bPos.y - 1; y <= bPos.y + 1; y++) {
			if (world.getBlock(x, y, newBZLower) !== BLOCK.AIR) {
				collisionCandidates.push({ z: newBZLower + 1, dir: 1, x1: x, y1: y, x2: x + 1, y2: y + 1 });
			}
			if (world.getBlock(x, y, newBZUpper) !== BLOCK.AIR) {
				collisionCandidates.push({ z: newBZUpper, dir: -1, x1: x, y1: y, x2: x + 1, y2: y + 1 });
			}
		}
	}

	// Solve Z collisions
	this.falling = true;
	for (const face of collisionCandidates) {
		if (rectRectCollide(face, playerFace) && velocity.z * face.dir < 0) {
			if (velocity.z < 0) {
				this.falling = false;
				pos.z = face.z;
				velocity.z = 0;
				this.velocity.z = 0;
			} else {
				pos.z = face.z - 1.8;
				velocity.z = 0;
				this.velocity.z = 0;
			}

			break;
		}
	}

	// Return solution
	return pos.add(velocity);
};