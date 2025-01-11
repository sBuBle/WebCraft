import { vec3, mat3, mat4, quat, vec4 } from 'gl-matrix'; // Ensure gl-matrix is imported correctly
import { BLOCK } from './blocks.js'; // Ensure BLOCK is imported correctly
import { Vector } from './helpers.js'; // Ensure Vector is imported
import { World } from './world.js'; // Ensure World is imported

// ==========================================
// Renderer
//
// This class contains the code that takes care of visualising the
// elements in the specified world.
// ==========================================

// Shaders
const vertexSource = `
	uniform mat4 uProjMatrix;
	uniform mat4 uViewMatrix;
	uniform mat4 uModelMatrix;
	attribute vec3 aPos;
	attribute vec4 aColor;
	attribute vec2 aTexCoord;
	varying vec4 vColor;
	varying vec2 vTexCoord;
	void main() {
		gl_Position = uProjMatrix * uViewMatrix * ( uModelMatrix * vec4( aPos, 1.0 ) );
		vColor = aColor;
		vTexCoord = aTexCoord;
	}
`;

const fragmentSource = `
	precision highp float;
	uniform sampler2D uSampler;
	varying vec4 vColor;
	varying vec2 vTexCoord;
	void main() {
		vec4 color = texture2D( uSampler, vec2( vTexCoord.s, vTexCoord.t ) ) * vec4( vColor.rgb, 1.0 );
		if ( color.a < 0.1 ) discard;
		gl_FragColor = vec4( color.rgb, vColor.a );
	}
`;

// Constructor( id )
//
// Creates a new renderer with the specified canvas as target.
//
// id - Identifier of the HTML canvas element to render to.

class ObjectPool {
	constructor(createFn, initialSize = 1000, maxSize = 100000) {
		this.pool = new Array(initialSize).fill(null).map(() => createFn());
		this.createFn = createFn;
		this.maxSize = maxSize;
	}

	acquire() {
		const obj = this.pool.pop() || this.createFn();
		if (obj instanceof Float32Array && obj.length > this.maxSize) {
			console.warn('Vertex buffer exceeding safe size');
		}
		return obj;
	}

	release(obj) {
		if (this.pool.length < 1000) {
			this.pool.push(obj);
		}
	}
}

export class Renderer {
	constructor(id) {
		const canvas = this.canvas = document.getElementById(id);
		canvas.renderer = this;
		canvas.width = canvas.clientWidth;
		canvas.height = canvas.clientHeight;

		// Initialise WebGL with fallback
		let gl;
		try {
			gl = this.gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
			if (!gl) throw new Error("WebGL not supported");
		} catch (e) {
			throw new Error("WebGL initialization failed: " + e.message);
		}

		// Handle context lost
		canvas.addEventListener('webglcontextlost', (e) => {
			e.preventDefault();
			this.handleContextLost();
		}, false);
		
		canvas.addEventListener('webglcontextrestored', () => {
			this.handleContextRestored();
		}, false);

		gl.viewportWidth = canvas.width;
		gl.viewportHeight = canvas.height;

		gl.clearColor(0.62, 0.81, 1.0, 1.0);
		gl.enable(gl.DEPTH_TEST);
		gl.enable(gl.CULL_FACE);
		gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

		 // Setup WebGL state
		 gl.enable(gl.DEPTH_TEST);
		 gl.depthFunc(gl.LEQUAL); // Change depth function
		 gl.enable(gl.CULL_FACE);
		 gl.cullFace(gl.BACK);

		 // Setup texture filtering with better settings
		 const setupTexture = (texture) => {
			gl.bindTexture(gl.TEXTURE_2D, texture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			
			// Enable anisotropic filtering if available
			const ext = (
				gl.getExtension('EXT_texture_filter_anisotropic') ||
				gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
				gl.getExtension('MOZ_EXT_texture_filter_anisotropic')
			);
			
			if (ext) {
				const max = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
				gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, max);
			}
		};

		// Load shaders
		this.loadShaders();

		// Load player model
		this.loadPlayerHeadModel();
		this.loadPlayerBodyModel();

		// Create projection and view matrices
		const projMatrix = this.projMatrix = mat4.create();
		const viewMatrix = this.viewMatrix = mat4.create();

		// Create dummy model matrix
		const modelMatrix = this.modelMatrix = mat4.create();
		mat4.identity(modelMatrix);
		gl.uniformMatrix4fv(this.uModelMat, false, modelMatrix);

		// Create 1px white texture for pure vertex color operations (e.g. picking)
		const whiteTexture = this.texWhite = gl.createTexture();
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, whiteTexture);
		const white = new Uint8Array([255, 255, 255, 255]);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, white);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.uniform1i(this.uSampler, 0);

		// Load player texture with error handling
		const playerTexture = this.texPlayer = gl.createTexture();
		playerTexture.image = new Image();
		playerTexture.image.onload = () => {
			gl.bindTexture(gl.TEXTURE_2D, playerTexture);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, playerTexture.image);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
			this.playerTextureLoaded = true;
		};
		playerTexture.image.onerror = () => {
			console.error("Failed to load player texture");
		};
		playerTexture.image.src = "media/player.png"; // Ensure the texture source is set

		// Load terrain texture
		const terrainTexture = this.texTerrain = gl.createTexture();
		terrainTexture.image = new Image();
		terrainTexture.image.onload = () => {
			gl.bindTexture(gl.TEXTURE_2D, terrainTexture);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, terrainTexture.image);
			gl.generateMipmap(gl.TEXTURE_2D);
			setupTexture(terrainTexture);
		};
		terrainTexture.image.src = "media/terrain.png"; // Ensure the texture source is set

		const textCanvas = this.textCanvas = document.createElement("canvas");
		textCanvas.width = 256;
		textCanvas.height = 64;
		textCanvas.style.display = "none";
		const ctx = this.textContext = textCanvas.getContext("2d");
		ctx.textAlign = "left";
		ctx.textBaseline = "middle";
		ctx.font = "24px Minecraftia";
		document.body.appendChild(textCanvas);

		// Initialize frustum planes
		this.frustumPlanes = [vec4.create(), vec4.create(), vec4.create(), vec4.create(), vec4.create(), vec4.create()];

		// Initialize world with noise-based terrain
		this.setWorld(new World(100, 100, 50), 16);

		// Add FPS tracking
		this.fpsStats = {
			lastTime: performance.now(),
			frames: 0,
			fps: 0,
			fpsElement: document.getElementById('fpsCounter')
		};

		// Add performance monitoring
		this.stats = {
			drawCalls: 0,
			vertices: 0,
			lastFrameTime: performance.now()
		};

		// Add texture loading tracking
		this.texturesLoaded = 0;
		this.totalTextures = 2; // player + terrain

		// Initialize vertex pool
		this.vertexPool = new ObjectPool(() => new Float32Array(10000));

		// Build initial chunks
		this.buildChunks(10); // Build initial chunks

		// Set initial perspective (was missing)
		this.setPerspective(Math.PI/4, this.canvas.width/this.canvas.height, 0.1, 1000);

		// Add chunk management settings
		this.chunkLoadDistance = 8; // How many chunks to load in each direction
		this.chunkUnloadDistance = 12; // When to unload chunks
		this.activeChunks = new Map(); // Track currently active chunks

		// Add chunk management properties
		this.chunkMap = new Map(); // Store chunks by coordinate key
		this.loadDistance = 8; // How many chunks to load in each direction
		this.unloadDistance = 12; // When to unload chunks
		this.maxChunksPerFrame = 2; // Limit chunk updates per frame
		this.chunkLoadQueue = []; // Priority queue for chunk loading
		this.chunks = []; // Initialize chunks
	}

	// draw()
	//
	// Render one frame of the world to the canvas.

	draw() {
		if (this.contextLost) return;
		
		const gl = this.gl;

		 // FPS calculation
		 const currentTime = performance.now();
		 this.fpsStats.frames++;
		 if (currentTime - this.fpsStats.lastTime >= 1000) {
			 this.fpsStats.fps = this.fpsStats.frames;
			 this.fpsStats.frames = 0;
			 this.fpsStats.lastTime = currentTime;
			 if (this.fpsStats.fpsElement) {
				 this.fpsStats.fpsElement.textContent = `FPS: ${this.fpsStats.fps}`;
			 }
		 }

		// Initialise view
		this.updateViewport();
		gl.viewport(0, 0, gl.viewportWidth, gl.viewportHeight);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		 // Update frustum planes
		 this.updateFrustumPlanes();

		 // Update chunks based on camera position
		 if (this.camPos) {
			 this.updateChunksAroundPlayer(new Vector(this.camPos[0], this.camPos[1], this.camPos[2]));
		 }

		// Draw level chunks
		const chunks = this.chunks;

		gl.bindTexture(gl.TEXTURE_2D, this.texTerrain);

		if (chunks != null) {
			for (let i = 0; i < chunks.length; i++) {
				if (chunks[i].buffer != null && this.isChunkInFrustum(chunks[i])) {
					this.drawBuffer(chunks[i].buffer);
				}
			}
		}

		// Draw chunks using chunk map
		gl.bindTexture(gl.TEXTURE_2D, this.texTerrain);
		
		for (const chunk of this.chunkMap.values()) {
			if (chunk.buffer && this.isChunkInFrustum(chunk)) {
				this.drawBuffer(chunk.buffer);
			}
		}

		// Draw players
		const players = this.world.players;

		gl.enable(gl.BLEND);

		for (const p in players) { // Ensure players is referenced correctly
			const player = players[p];

			let aniangle;
			if (player.moving || Math.abs(player.aniframe) > 0.1) {
				player.aniframe += 0.15;
				if (player.aniframe > Math.PI)
					player.aniframe = -Math.PI;
				aniangle = Math.PI / 2 * Math.sin(player.aniframe);
				if (!player.moving && Math.abs(aniangle) < 0.1)
					player.aniframe = 0;
			} else {
				aniangle = 0;
			}

			// Draw head		
			let pitch = player.pitch;
			if (pitch < -0.32) pitch = -0.32;
			if (pitch > 0.32) pitch = 0.32;

			mat4.identity(this.modelMatrix);
			mat4.translate(this.modelMatrix, [player.x, player.y, player.z + 1.7]);
			mat4.rotateZ(this.modelMatrix, Math.PI - player.yaw);
			mat4.rotateX(this.modelMatrix, -pitch);
			gl.uniformMatrix4fv(this.uModelMat, false, this.modelMatrix);

			gl.bindTexture(gl.TEXTURE_2D, this.texPlayer);
			this.drawBuffer(this.playerHead);

			// Draw body
			mat4.identity(this.modelMatrix);
			mat4.translate(this.modelMatrix, [player.x, player.y, player.z + 0.01]);
			mat4.rotateZ(this.modelMatrix, Math.PI - player.yaw);
			gl.uniformMatrix4fv(this.uModelMat, false, this.modelMatrix);
			this.drawBuffer(this.playerBody);

			mat4.translate(this.modelMatrix, [0, 0, 1.4]);
			mat4.rotateX(this.modelMatrix, 0.75 * aniangle);
			gl.uniformMatrix4fv(this.uModelMat, false, this.modelMatrix);
			this.drawBuffer(this.playerLeftArm);

			mat4.rotateX(this.modelMatrix, -1.5 * aniangle);
			gl.uniformMatrix4fv(this.uModelMat, false, this.modelMatrix);
			this.drawBuffer(this.playerRightArm);
			mat4.rotateX(this.modelMatrix, 0.75 * aniangle);

			mat4.translate(this.modelMatrix, [0, 0, -0.67]);

			mat4.rotateX(this.modelMatrix, 0.5 * aniangle);
			gl.uniformMatrix4fv(this.uModelMat, false, this.modelMatrix);
			this.drawBuffer(this.playerRightLeg);

			mat4.rotateX(this.modelMatrix, -aniangle);
			gl.uniformMatrix4fv(this.uModelMat, false, this.modelMatrix);
			this.drawBuffer(this.playerLeftLeg);

			// Draw player name		
			if (!player.nametag) {
				player.nametag = this.buildPlayerName(player.nick);
			}

			// Calculate angle so that the nametag always faces the local player
			const ang = -Math.PI / 2 + Math.atan2(this.camPos[1] - player.y, this.camPos[0] - player.x);

			mat4.identity(this.modelMatrix);
			mat4.translate(this.modelMatrix, [player.x, player.y, player.z + 2.05]);
			mat4.rotateZ(this.modelMatrix, ang);
			mat4.scale(this.modelMatrix, [0.005, 1, 0.005]);
			gl.uniformMatrix4fv(this.uModelMat, false, this.modelMatrix);

			gl.bindTexture(gl.TEXTURE_2D, player.nametag.texture);
			this.drawBuffer(player.nametag.model);
		}

		gl.disable(gl.BLEND);

		mat4.identity(this.modelMatrix);
		gl.uniformMatrix4fv(this.uModelMat, false, this.modelMatrix);

	}

	drawBuffer(buffer) {
		const gl = this.gl;

		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		
		// Enable attributes
		gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 9 * 4, 0);
		gl.vertexAttribPointer(this.aTexCoord, 2, gl.FLOAT, false, 9 * 4, 3 * 4);
		gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, 9 * 4, 5 * 4);

		// Set consistent vertex colors
		gl.vertexAttrib4f(this.aColor, 1.0, 1.0, 1.0, 1.0);

		// Use a larger polygon offset to prevent z-fighting
		gl.enable(gl.POLYGON_OFFSET_FILL);
		gl.polygonOffset(2.0, 2.0);

		// Enable depth testing with less equal
		gl.enable(gl.DEPTH_TEST);
		gl.depthFunc(gl.LEQUAL);

		gl.drawArrays(gl.TRIANGLES, 0, buffer.vertices);

		// Restore state
		gl.disable(gl.POLYGON_OFFSET_FILL);
	}

	// buildPlayerName( nickname )
	//
	// Returns the texture and vertex buffer for drawing the name
	// tag of the specified player.

	buildPlayerName(nickname) {
		const gl = this.gl;
		const canvas = this.textCanvas;
		const ctx = this.textContext;

		nickname = nickname.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/, "\"");

		const w = ctx.measureText(nickname).width + 16;
		const h = 45;

		// Draw text box
		ctx.fillStyle = "#000";
		ctx.fillRect(0, 0, w, 45);

		ctx.fillStyle = "#fff";
		ctx.fillText(nickname, 10, 20);

		// Create texture
		const tex = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

		// Create model
		const vertices = [
			-w / 2, 0, h, w / 256, 0, 1, 1, 1, 0.7,
			w / 2, 0, h, 0, 0, 1, 1, 1, 0.7,
			w / 2, 0, 0, 0, h / 64, 1, 1, 1, 0.7,
			w / 2, 0, 0, 0, h / 64, 1, 1, 1, 0.7,
			-w / 2, 0, 0, w / 256, h / 64, 1, 1, 1, 0.7,
			-w / 2, 0, h, w / 256, 0, 1, 1, 1, 0.7
		];

		const buffer = gl.createBuffer();
		buffer.vertices = vertices.length / 9;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);

		return {
			texture: tex,
			model: buffer
		};
	}

	// pickAt( min, max, mx, myy )
	//
	// Returns the block at mouse position mx and my.
	// The blocks that can be reached lie between min and max.
	//
	// Each side is rendered with the X, Y and Z position of the
	// block in the RGB color values and the normal of the side is
	// stored in the color alpha value. In that way, all information
	// can be retrieved by simply reading the pixel the mouse is over.
	//
	// WARNING: This implies that the level can never be larger than
	// 254x254x254 blocks! (Value 255 is used for sky.)

	pickAt(min, max, mx, my) {
		const gl = this.gl;
		const world = this.world;

		// Create framebuffer for picking render
		const fbo = gl.createFramebuffer();
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

		const bt = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, bt);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 512, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

		const renderbuffer = gl.createRenderbuffer();
		gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 512, 512);

		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, bt, 0);
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, renderbuffer);

		// Build buffer with block pick candidates
		const vertices = [];

		for (let x = min.x; x <= max.x; x++) {
			for (let y = min.y; y <= max.y; y++) {
				for (let z = min.z; z <= max.z; z++) {
					if (world.getBlock(x, y, z) != BLOCK.AIR)
						BLOCK.pushPickingVertices(vertices, x, y, z);
				}
			}
		}

		const buffer = gl.createBuffer();
		buffer.vertices = vertices.length / 9;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);

		// Draw buffer
		gl.bindTexture(gl.TEXTURE_2D, this.texWhite);

		gl.viewport(0, 0, 512, 512);
		gl.clearColor(1.0, 1.0, 1.0, 1.0);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

		this.drawBuffer(buffer);

		// Read pixel
		const pixel = new Uint8Array(4);
		gl.readPixels(mx / gl.viewportWidth * 512, (1 - my / gl.viewportHeight) * 512, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

		// Reset states
		gl.bindTexture(gl.TEXTURE_2D, this.texTerrain);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.clearColor(0.62, 0.81, 1.0, 1.0);

		// Clean up
		gl.deleteBuffer(buffer);
		gl.deleteRenderbuffer(renderbuffer);
		gl.deleteTexture(bt);
		gl.deleteFramebuffer(fbo);

		// Build result
		if (pixel[0] != 255) {
			let normal;
			if (pixel[3] == 1) normal = new Vector(0, 0, 1);
			else if (pixel[3] == 2) normal = new Vector(0, 0, -1);
			else if (pixel[3] == 3) normal = new Vector(0, -1, 0);
			else if (pixel[3] == 4) normal = new Vector(0, 1, 0);
			else if (pixel[3] == 5) normal = new Vector(-1, 0, 0);
			else if (pixel[3] == 6) normal = new Vector(1, 0, 0);

			return {
				x: pixel[0],
				y: pixel[1],
				z: pixel[2],
				n: normal
			}
		} else {
			return false;
		}
	}

	// updateViewport()
	//
	// Check if the viewport is still the same size and update
	// the render configuration if required.

	updateViewport() {
		const gl = this.gl;
		const canvas = this.canvas;

		if (canvas.clientWidth != gl.viewportWidth || canvas.clientHeight != gl.viewportHeight) {
			// Update canvas size
			gl.viewportWidth = canvas.clientWidth;
			gl.viewportHeight = canvas.clientHeight;
			canvas.width = canvas.clientWidth;
			canvas.height = canvas.clientHeight;

			// Update perspective projection based on new w/h ratio
			mat4.perspectiveNO(this.projMatrix, this.fov, canvas.width / canvas.height, this.min, this.max);
			gl.uniformMatrix4fv(this.uProjMat, false, this.projMatrix);

			// Force chunk rebuild after resize
			if (this.chunks) {
				this.chunks.forEach(chunk => chunk.dirty = true);
			}
			if (this.chunkMap) {
				for (const chunk of this.chunkMap.values()) {
					chunk.dirty = true;
				}
			}

			// Rebuild chunks immediately
			this.buildChunks(10);
		}
	}

	// loadShaders()
	//
	// Takes care of loading the shaders.

	loadShaders() {
		const gl = this.gl;

		// Create shader program
		const program = this.program = gl.createProgram();

		// Compile vertex shader
		const vertexShader = gl.createShader(gl.VERTEX_SHADER);
		gl.shaderSource(vertexShader, vertexSource);
		gl.compileShader(vertexShader);
		gl.attachShader(program, vertexShader);

		if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS))
			throw new Error(`Could not compile vertex shader!\n${gl.getShaderInfoLog(vertexShader)}`);

		// Compile fragment shader
		const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
		gl.shaderSource(fragmentShader, fragmentSource);
		gl.compileShader(fragmentShader);
		gl.attachShader(program, fragmentShader);

		if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS))
			throw new Error(`Could not compile fragment shader!\n${gl.getShaderInfoLog(fragmentShader)}`);

		// Finish program
		gl.linkProgram(program);

		if (!gl.getProgramParameter(program, gl.LINK_STATUS))
			throw new Error("Could not link the shader program!");

		gl.useProgram(program);

		// Store variable locations
		this.uProjMat = gl.getUniformLocation(program, "uProjMatrix");
		this.uViewMat = gl.getUniformLocation(program, "uViewMatrix");
		this.uModelMat = gl.getUniformLocation(program, "uModelMatrix");
		this.uSampler = gl.getUniformLocation(program, "uSampler");
		this.aPos = gl.getAttribLocation(program, "aPos");
		this.aColor = gl.getAttribLocation(program, "aColor");
		this.aTexCoord = gl.getAttribLocation(program, "aTexCoord");

		// Enable input
		gl.enableVertexAttribArray(this.aPos);
		gl.enableVertexAttribArray(this.aColor);
		gl.enableVertexAttribArray(this.aTexCoord);
	}

	// setWorld( world, chunkSize )
	//
	// Makes the renderer start tracking a new world and set up the chunk structure.
	//
	// world - The world object to operate on.
	// chunkSize - X, Y and Z dimensions of each chunk, doesn't have to fit exactly inside the world.

	setWorld(world, chunkSize) {
		this.world = world;
		world.renderer = this;
		this.chunkSize = chunkSize;
		if (this.chunkMap) {
			this.chunkMap.clear(); // Ensure chunkMap is cleared
		} else {
			this.chunkMap = new Map(); // Initialize chunkMap if not already
		}
		this.chunks = []; // Ensure chunks is cleared
		console.log("World set with chunk size:", chunkSize);
	}

	getChunkKey(x, y, z) {
		return `${Math.floor(x/this.chunkSize)},${Math.floor(y/this.chunkSize)},${Math.floor(z/this.chunkSize)}`;
	}

	updateChunksAroundPlayer(playerPos) {
		// Get player chunk coordinates
		const px = Math.floor(playerPos.x / this.chunkSize);
		const py = Math.floor(playerPos.y / this.chunkSize);
		const pz = Math.floor(playerPos.z / this.chunkSize);

		// Calculate view direction
		const viewVector = new Vector(
			Math.cos(this.camPos[1]) * Math.cos(this.camPos[0]),
			Math.sin(this.camPos[1]) * Math.cos(this.camPos[0]),
			Math.sin(this.camPos[0])
		);

		// Clear load queue
		this.chunkLoadQueue = [];

		// Add chunks to load queue with priority
		for (let x = px - this.loadDistance; x <= px + this.loadDistance; x++) {
			for (let y = py - this.loadDistance; y <= py + this.loadDistance; y++) {
				for (let z = pz - this.loadDistance; z <= pz + this.loadDistance; z++) {
					if (!this.world.isInBounds(x * this.chunkSize, y * this.chunkSize, z * this.chunkSize)) {
						continue;
					}

					const dx = x - px;
					const dy = y - py;
					const dz = z - pz;
					const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
					
					if (distance <= this.loadDistance) {
						const key = this.getChunkKey(x * this.chunkSize, y * this.chunkSize, z * this.chunkSize);
						const chunk = this.chunkMap.get(key);
						
						// Prioritize chunks in view direction
						const viewAlignment = dx * viewVector.x + dy * viewVector.y + dz * viewVector.z;
						const priority = distance - (viewAlignment > 0 ? 2 : 0);

						if (!chunk) {
							// Create new chunk
							this.chunkLoadQueue.push({
								x: x * this.chunkSize,
								y: y * this.chunkSize,
								z: z * this.chunkSize,
								priority: priority
							});
						}
					}
				}
			}
		}

		// Sort load queue by priority
		this.chunkLoadQueue.sort((a, b) => a.priority - b.priority);

		// Unload distant chunks
		for (const [key, chunk] of this.chunkMap) {
			const [cx, cy, cz] = key.split(',').map(Number);
			const dx = cx - px;
			const dy = cy - py;
			const dz = cz - pz;
			const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);

			if (distance > this.unloadDistance) {
				if (chunk.buffer) {
					this.gl.deleteBuffer(chunk.buffer);
				}
				this.chunkMap.delete(key);
			}
		}

		// Process chunk load queue
		this.processChunkQueue();
	}

	processChunkQueue() {
		const maxChunks = this.maxChunksPerFrame;
		let processed = 0;

		while (processed < maxChunks && this.chunkLoadQueue.length > 0) {
			const chunk = this.chunkLoadQueue.shift();
			this.createChunk(chunk.x, chunk.y, chunk.z);
			processed++;
		}
	}

	createChunk(x, y, z) {
		const chunk = {
			start: [x, y, z],
			end: [
				Math.min(x + this.chunkSize, this.world.sx),
				Math.min(y + this.chunkSize, this.world.sy),
				Math.min(z + this.chunkSize, this.world.sz)
			],
			dirty: true,
			buffer: null
		};

		const key = this.getChunkKey(x, y, z);
		this.chunkMap.set(key, chunk);
		
		// Build chunk immediately if close to player
		if (chunk.dirty) {
			this.buildChunk(chunk);
		}

		return chunk;
	}

	buildChunk(chunk) {
		const gl = this.gl;
		const vertexData = [];

		// Add vertices
		for (let x = chunk.start[0]; x < chunk.end[0]; x++) {
			for (let y = chunk.start[1]; y < chunk.end[1]; y++) {
				for (let z = chunk.start[2]; z < chunk.end[2]; z++) {
					if (this.world.blocks[x]?.[y]?.[z]?.id !== BLOCK.AIR.id) {
						BLOCK.pushVertices(vertexData, this.world, this.world.lightmap, x, y, z);
					}
				}
			}
		}

		// Create buffer if we have vertices
		if (vertexData.length > 0) {
			if (chunk.buffer) gl.deleteBuffer(chunk.buffer);
			const buffer = chunk.buffer = gl.createBuffer();
			
			if (!buffer) {
				throw new Error('Failed to create WebGL buffer');
			}

			buffer.vertices = vertexData.length / 9;
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexData), gl.STATIC_DRAW);
		}

		chunk.dirty = false;
	}

	// onBlockChanged( x, y, z )
	//
	// Callback from world to inform the renderer of a changed block

	onBlockChanged(x, y, z) {
		this.eventQueue.push({ type: 'blockChanged', x, y, z });
	}

	// buildChunks( count )
	//
	// Build up to <count> dirty chunks.

	buildChunks(count) {
		const gl = this.gl;
		
		try {
			let chunksBuilt = 0;
			console.log("Building chunks...");
			
			for (let i = 0; i < this.chunks.length; i++) {
				const chunk = this.chunks[i];
				
				if (!chunk.dirty) {
					continue;
				}

				console.log(`Building chunk ${i}/${this.chunks.length}`);

				 // Create temporary array for collecting vertices
				 const vertexData = [];

				 // Add vertices
				 for (let x = chunk.start[0]; x < chunk.end[0]; x++) {
					 for (let y = chunk.start[1]; y < chunk.end[1]; y++) {
						 for (let z = chunk.start[2]; z < chunk.end[2]; z++) {
							 if (this.world.blocks[x][y][z]?.id !== BLOCK.AIR.id) {
								 BLOCK.pushVertices(vertexData, this.world, this.world.lightmap, x, y, z);
							 }
						 }
					 }
				 }
 
				 // Create WebGL buffer only if we have vertices
				 if (vertexData.length > 0) {
					 if (chunk.buffer) gl.deleteBuffer(chunk.buffer);
					 const buffer = chunk.buffer = gl.createBuffer();
					 
					 if (!buffer) {
						 throw new Error('Failed to create WebGL buffer');
					 }
 
					 buffer.vertices = vertexData.length / 9;
					 gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
					 gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexData), gl.STATIC_DRAW);
					 chunksBuilt++;
				 }
 
				 chunk.dirty = false;
				 count--;
 
				 if (count === 0) break;
			}
			console.log(`Built ${chunksBuilt} chunks`);
		} catch (err) {
			console.error('Error building chunks:', err);
		}
	}

	buildChunksAroundPlayer(playerPos, count) {
		const gl = this.gl;
		
		try {
			// Sort chunks by distance to player
			const sortedChunks = this.chunks
				.filter(chunk => chunk.dirty)
				.map(chunk => {
					const cx = (chunk.start[0] + chunk.end[0]) / 2;
					const cy = (chunk.start[1] + chunk.end[1]) / 2;
					const cz = (chunk.start[2] + chunk.end[2]) / 2;
					const dist = Math.sqrt(
						Math.pow(cx - playerPos.x, 2) +
						Math.pow(cy - playerPos.y, 2) +
						Math.pow(cz - playerPos.z, 2)
					);
					return { chunk, dist };
				})
				.sort((a, b) => a.dist - b.dist);

			let built = 0;
			for (const { chunk } of sortedChunks) {
				if (built >= count) break;
				
				const vertexData = [];
				
				// Add vertices
				for (let x = chunk.start[0]; x < chunk.end[0]; x++) {
					for (let y = chunk.start[1]; y < chunk.end[1]; y++) {
						for (let z = chunk.start[2]; z < chunk.end[2]; z++) {
							const block = this.world.blocks[x][y][z];
							if (block && block.id !== BLOCK.AIR.id) {
								BLOCK.pushVertices(vertexData, this.world, this.world.lightmap, x, y, z);
							}
						}
					}
				}

				if (vertexData.length > 0) {
					if (chunk.buffer) gl.deleteBuffer(chunk.buffer);
					const buffer = chunk.buffer = gl.createBuffer();
					
					if (!buffer) {
						throw new Error('Failed to create WebGL buffer');
					}

					buffer.vertices = vertexData.length / 9;
					gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
					gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertexData), gl.STATIC_DRAW);
					built++;
				}

				chunk.dirty = false;
			}
			
			if (built > 0) {
				console.log(`Built ${built} chunks near player`);
			}
		} catch (err) {
			console.error('Error building chunks around player:', err);
		}
	}

	// setPerspective( fov, aspect, near, far )
	//
	// Sets the properties of the perspective projection.

	setPerspective(fov, aspect, near, far) {
		const gl = this.gl;

		this.fov = fov;
		this.min = near;
		this.max = far;

		mat4.perspectiveNO(this.projMatrix, fov, aspect, near, far); // Use mat4.perspectiveNO
		gl.uniformMatrix4fv(this.uProjMat, false, this.projMatrix);
	}

	// setCamera( pos, ang )
	//
	// Moves the camera to the specified orientation.
	//
	// pos - Position in world coordinates.
	// ang - Pitch, yaw and roll.

	setCamera(pos, ang) {
		const gl = this.gl;

		this.camPos = pos;

		mat4.identity(this.viewMatrix);

		mat4.rotateX(this.viewMatrix, this.viewMatrix, -ang[0] - Math.PI / 2); // Use mat4.rotateX
		mat4.rotateZ(this.viewMatrix, this.viewMatrix, ang[1]); // Use mat4.rotateZ
		mat4.rotateY(this.viewMatrix, this.viewMatrix, -ang[2]); // Use mat4.rotateY

		mat4.translate(this.viewMatrix, this.viewMatrix, [-pos[0], -pos[1], -pos[2]]); // Use mat4.translate

		gl.uniformMatrix4fv(this.uViewMat, false, this.viewMatrix);
	}

	// loadPlayerHeadModel()
	//
	// Loads the player head model into a vertex buffer for rendering.

	loadPlayerHeadModel() {
		const gl = this.gl;

		// Player head
		const vertices = [
			// Top
			-0.25, -0.25, 0.25, 8 / 64, 0, 1, 1, 1, 1,
			0.25, -0.25, 0.25, 16 / 64, 0, 1, 1, 1, 1,
			0.25, 0.25, 0.25, 16 / 64, 8 / 32, 1, 1, 1, 1,
			0.25, 0.25, 0.25, 16 / 64, 8 / 32, 1, 1, 1, 1,
			-0.25, 0.25, 0.25, 8 / 64, 8 / 32, 1, 1, 1, 1,
			-0.25, -0.25, 0.25, 8 / 64, 0, 1, 1, 1, 1,

			// Bottom
			-0.25, -0.25, -0.25, 16 / 64, 0, 1, 1, 1, 1,
			-0.25, 0.25, -0.25, 16 / 64, 8 / 32, 1, 1, 1, 1,
			0.25, 0.25, -0.25, 24 / 64, 8 / 32, 1, 1, 1, 1,
			0.25, 0.25, -0.25, 24 / 64, 8 / 32, 1, 1, 1, 1,
			0.25, -0.25, -0.25, 24 / 64, 0, 1, 1, 1, 1,
			-0.25, -0.25, -0.25, 16 / 64, 0, 1, 1, 1, 1,

			// Front		
			-0.25, -0.25, 0.25, 8 / 64, 8 / 32, 1, 1, 1, 1,
			-0.25, -0.25, -0.25, 8 / 64, 16 / 32, 1, 1, 1, 1,
			0.25, -0.25, -0.25, 16 / 64, 16 / 32, 1, 1, 1, 1,
			0.25, -0.25, -0.25, 16 / 64, 16 / 32, 1, 1, 1, 1,
			0.25, -0.25, 0.25, 16 / 64, 8 / 32, 1, 1, 1, 1,
			-0.25, -0.25, 0.25, 8 / 64, 8 / 32, 1, 1, 1, 1,

			// Rear		
			-0.25, 0.25, 0.25, 24 / 64, 8 / 32, 1, 1, 1, 1,
			0.25, 0.25, 0.25, 32 / 64, 8 / 32, 1, 1, 1, 1,
			0.25, 0.25, -0.25, 32 / 64, 16 / 32, 1, 1, 1, 1,
			0.25, 0.25, -0.25, 32 / 64, 16 / 32, 1, 1, 1, 1,
			-0.25, 0.25, -0.25, 24 / 64, 16 / 32, 1, 1, 1, 1,
			-0.25, 0.25, 0.25, 24 / 64, 8 / 32, 1, 1, 1, 1,

			// Right
			-0.25, -0.25, 0.25, 16 / 64, 8 / 32, 1, 1, 1, 1,
			-0.25, 0.25, 0.25, 24 / 64, 8 / 32, 1, 1, 1, 1,
			-0.25, 0.25, -0.25, 24 / 64, 16 / 32, 1, 1, 1, 1,
			-0.25, 0.25, -0.25, 24 / 64, 16 / 32, 1, 1, 1, 1,
			-0.25, -0.25, -0.25, 16 / 64, 16 / 32, 1, 1, 1, 1,
			-0.25, -0.25, 0.25, 16 / 64, 8 / 32, 1, 1, 1, 1,

			// Left
			0.25, -0.25, 0.25, 0, 8 / 32, 1, 1, 1, 1,
			0.25, -0.25, -0.25, 0, 16 / 32, 1, 1, 1, 1,
			0.25, 0.25, -0.25, 8 / 64, 16 / 32, 1, 1, 1, 1,
			0.25, 0.25, -0.25, 8 / 64, 16 / 32, 1, 1, 1, 1,
			0.25, 0.25, 0.25, 8 / 64, 8 / 32, 1, 1, 1, 1,
			0.25, -0.25, 0.25, 0, 8 / 32, 1, 1, 1, 1
		];

		const buffer = this.playerHead = gl.createBuffer();
		buffer.vertices = vertices.length / 9;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
	}

	// loadPlayerBodyModel()
	//
	// Loads the player body model into a vertex buffer for rendering.

	loadPlayerBodyModel() {
		const gl = this.gl;

		let vertices = [
			// Player torso

			// Top
			-0.30, -0.125, 1.45, 20 / 64, 16 / 32, 1, 1, 1, 1,
			0.30, -0.125, 1.45, 28 / 64, 16 / 32, 1, 1, 1, 1,
			0.30, 0.125, 1.45, 28 / 64, 20 / 32, 1, 1, 1, 1,
			0.30, 0.125, 1.45, 28 / 64, 20 / 32, 1, 1, 1, 1,
			-0.30, 0.125, 1.45, 20 / 64, 20 / 32, 1, 1, 1, 1,
			-0.30, -0.125, 1.45, 20 / 64, 16 / 32, 1, 1, 1, 1,

			// Bottom
			-0.30, -0.125, 0.73, 28 / 64, 16 / 32, 1, 1, 1, 1,
			-0.30, 0.125, 0.73, 28 / 64, 20 / 32, 1, 1, 1, 1,
			0.30, 0.125, 0.73, 36 / 64, 20 / 32, 1, 1, 1, 1,
			0.30, 0.125, 0.73, 36 / 64, 20 / 32, 1, 1, 1, 1,
			0.30, -0.125, 0.73, 36 / 64, 16 / 32, 1, 1, 1, 1,
			-0.30, -0.125, 0.73, 28 / 64, 16 / 32, 1, 1, 1, 1,

			// Front		
			-0.30, -0.125, 1.45, 20 / 64, 20 / 32, 1, 1, 1, 1,
			-0.30, -0.125, 0.73, 20 / 64, 32 / 32, 1, 1, 1, 1,
			0.30, -0.125, 0.73, 28 / 64, 32 / 32, 1, 1, 1, 1,
			0.30, -0.125, 0.73, 28 / 64, 32 / 32, 1, 1, 1, 1,
			0.30, -0.125, 1.45, 28 / 64, 20 / 32, 1, 1, 1, 1,
			-0.30, -0.125, 1.45, 20 / 64, 20 / 32, 1, 1, 1, 1,

			// Rear		
			-0.30, 0.125, 1.45, 40 / 64, 20 / 32, 1, 1, 1, 1,
			0.30, 0.125, 1.45, 32 / 64, 20 / 32, 1, 1, 1, 1,
			0.30, 0.125, 0.73, 32 / 64, 32 / 32, 1, 1, 1, 1,
			0.30, 0.125, 0.73, 32 / 64, 32 / 32, 1, 1, 1, 1,
			-0.30, 0.125, 0.73, 40 / 64, 32 / 32, 1, 1, 1, 1,
			-0.30, 0.125, 1.45, 40 / 64, 20 / 32, 1, 1, 1, 1,

			// Right
			-0.30, -0.125, 1.45, 16 / 64, 20 / 32, 1, 1, 1, 1,
			-0.30, 0.125, 1.45, 20 / 64, 20 / 32, 1, 1, 1, 1,
			-0.30, 0.125, 0.73, 20 / 64, 32 / 32, 1, 1, 1, 1,
			-0.30, 0.125, 0.73, 20 / 64, 32 / 32, 1, 1, 1, 1,
			-0.30, -0.125, 0.73, 16 / 64, 32 / 32, 1, 1, 1, 1,
			-0.30, -0.125, 1.45, 16 / 64, 20 / 32, 1, 1, 1, 1,

			// Left
			0.30, -0.125, 1.45, 28 / 64, 20 / 32, 1, 1, 1, 1,
			0.30, -0.125, 0.73, 28 / 64, 32 / 32, 1, 1, 1, 1,
			0.30, 0.125, 0.73, 32 / 64, 32 / 32, 1, 1, 1, 1,
			0.30, 0.125, 0.73, 32 / 64, 32 / 32, 1, 1, 1, 1,
			0.30, 0.125, 1.45, 32 / 64, 20 / 32, 1, 1, 1, 1,
			0.30, -0.125, 1.45, 28 / 64, 20 / 32, 1, 1, 1, 1,

		];

		let buffer = this.playerBody = gl.createBuffer();
		buffer.vertices = vertices.length / 9;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);

		vertices = [
			// Left arm

			// Top
			0.30, -0.125, 0.05, 44 / 64, 16 / 32, 1, 1, 1, 1,
			0.55, -0.125, 0.05, 48 / 64, 16 / 32, 1, 1, 1, 1,
			0.55, 0.125, 0.05, 48 / 64, 20 / 32, 1, 1, 1, 1,
			0.55, 0.125, 0.05, 48 / 64, 20 / 32, 1, 1, 1, 1,
			0.30, 0.125, 0.05, 44 / 64, 20 / 32, 1, 1, 1, 1,
			0.30, -0.125, 0.05, 44 / 64, 16 / 32, 1, 1, 1, 1,

			// Bottom
			0.30, -0.125, -0.67, 48 / 64, 16 / 32, 1, 1, 1, 1,
			0.30, 0.125, -0.67, 48 / 64, 20 / 32, 1, 1, 1, 1,
			0.55, 0.125, -0.67, 52 / 64, 20 / 32, 1, 1, 1, 1,
			0.55, 0.125, -0.67, 52 / 64, 20 / 32, 1, 1, 1, 1,
			0.55, -0.125, -0.67, 52 / 64, 16 / 32, 1, 1, 1, 1,
			0.30, -0.125, -0.67, 48 / 64, 16 / 32, 1, 1, 1, 1,

			// Front		
			0.30, -0.125, 0.05, 48 / 64, 20 / 32, 1, 1, 1, 1,
			0.30, -0.125, -0.67, 48 / 64, 32 / 32, 1, 1, 1, 1,
			0.55, -0.125, -0.67, 44 / 64, 32 / 32, 1, 1, 1, 1,
			0.55, -0.125, -0.67, 44 / 64, 32 / 32, 1, 1, 1, 1,
			0.55, -0.125, 0.05, 44 / 64, 20 / 32, 1, 1, 1, 1,
			0.30, -0.125, 0.05, 48 / 64, 20 / 32, 1, 1, 1, 1,

			// Rear		
			0.30, 0.125, 0.05, 52 / 64, 20 / 32, 1, 1, 1, 1,
			0.55, 0.125, 0.05, 56 / 64, 20 / 32, 1, 1, 1, 1,
			0.55, 0.125, -0.67, 56 / 64, 32 / 32, 1, 1, 1, 1,
			0.55, 0.125, -0.67, 56 / 64, 32 / 32, 1, 1, 1, 1,
			0.30, 0.125, -0.67, 52 / 64, 32 / 32, 1, 1, 1, 1,
			0.30, 0.125, 0.05, 52 / 64, 20 / 32, 1, 1, 1, 1,

			// Right
			0.30, -0.125, 0.05, 48 / 64, 20 / 32, 1, 1, 1, 1,
			0.30, 0.125, 0.05, 52 / 64, 20 / 32, 1, 1, 1, 1,
			0.30, 0.125, -0.67, 52 / 64, 32 / 32, 1, 1, 1, 1,
			0.30, 0.125, -0.67, 52 / 64, 32 / 32, 1, 1, 1, 1,
			0.30, -0.125, -0.67, 48 / 64, 32 / 32, 1, 1, 1, 1,
			0.30, -0.125, 0.05, 48 / 64, 20 / 32, 1, 1, 1, 1,

			// Left
			0.55, -0.125, 0.05, 44 / 64, 20 / 32, 1, 1, 1, 1,
			0.55, -0.125, -0.67, 44 / 64, 32 / 32, 1, 1, 1, 1,
			0.55, 0.125, -0.67, 40 / 64, 32 / 32, 1, 1, 1, 1,
			0.55, 0.125, -0.67, 40 / 64, 32 / 32, 1, 1, 1, 1,
			0.55, 0.125, 0.05, 40 / 64, 20 / 32, 1, 1, 1, 1,
			0.55, -0.125, 0.05, 44 / 64, 20 / 32, 1, 1, 1, 1,

		];

		buffer = this.playerLeftArm = gl.createBuffer();
		buffer.vertices = vertices.length / 9;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);

		vertices = [
			// Right arm

			// Top
			-0.55, -0.125, 0.05, 44 / 64, 16 / 32, 1, 1, 1, 1,
			-0.30, -0.125, 0.05, 48 / 64, 16 / 32, 1, 1, 1, 1,
			-0.30, 0.125, 0.05, 48 / 64, 20 / 32, 1, 1, 1, 1,
			-0.30, 0.125, 0.05, 48 / 64, 20 / 32, 1, 1, 1, 1,
			-0.55, 0.125, 0.05, 44 / 64, 20 / 32, 1, 1, 1, 1,
			-0.55, -0.125, 0.05, 44 / 64, 16 / 32, 1, 1, 1, 1,

			// Bottom
			-0.55, -0.125, -0.67, 52 / 64, 16 / 32, 1, 1, 1, 1,
			-0.55, 0.125, -0.67, 52 / 64, 20 / 32, 1, 1, 1, 1,
			-0.30, 0.125, -0.67, 48 / 64, 20 / 32, 1, 1, 1, 1,
			-0.30, 0.125, -0.67, 48 / 64, 20 / 32, 1, 1, 1, 1,
			-0.30, -0.125, -0.67, 48 / 64, 16 / 32, 1, 1, 1, 1,
			-0.55, -0.125, -0.67, 52 / 64, 16 / 32, 1, 1, 1, 1,

			// Front		
			-0.55, -0.125, 0.05, 44 / 64, 20 / 32, 1, 1, 1, 1,
			-0.55, -0.125, -0.67, 44 / 64, 32 / 32, 1, 1, 1, 1,
			-0.30, -0.125, -0.67, 48 / 64, 32 / 32, 1, 1, 1, 1,
			-0.30, -0.125, -0.67, 48 / 64, 32 / 32, 1, 1, 1, 1,
			-0.30, -0.125, 0.05, 48 / 64, 20 / 32, 1, 1, 1, 1,
			-0.55, -0.125, 0.05, 44 / 64, 20 / 32, 1, 1, 1, 1,

			// Rear		
			-0.55, 0.125, 0.05, 56 / 64, 20 / 32, 1, 1, 1, 1,
			-0.30, 0.125, 0.05, 52 / 64, 20 / 32, 1, 1, 1, 1,
			-0.30, 0.125, -0.67, 52 / 64, 32 / 32, 1, 1, 1, 1,
			-0.30, 0.125, -0.67, 52 / 64, 32 / 32, 1, 1, 1, 1,
			-0.55, 0.125, -0.67, 56 / 64, 32 / 32, 1, 1, 1, 1,
			-0.55, 0.125, 0.05, 56 / 64, 20 / 32, 1, 1, 1, 1,

			// Right
			-0.55, -0.125, 0.05, 44 / 64, 20 / 32, 1, 1, 1, 1,
			-0.55, 0.125, 0.05, 40 / 64, 20 / 32, 1, 1, 1, 1,
			-0.55, 0.125, -0.67, 40 / 64, 32 / 32, 1, 1, 1, 1,
			-0.55, 0.125, -0.67, 40 / 64, 32 / 32, 1, 1, 1, 1,
			-0.55, -0.125, -0.67, 44 / 64, 32 / 32, 1, 1, 1, 1,
			-0.55, -0.125, 0.05, 44 / 64, 20 / 32, 1, 1, 1, 1,

			// Left
			-0.30, -0.125, 0.05, 48 / 64, 20 / 32, 1, 1, 1, 1,
			-0.30, -0.125, -0.67, 48 / 64, 32 / 32, 1, 1, 1, 1,
			-0.30, 0.125, -0.67, 52 / 64, 32 / 32, 1, 1, 1, 1,
			-0.30, 0.125, -0.67, 52 / 64, 32 / 32, 1, 1, 1, 1,
			-0.30, 0.125, 0.05, 52 / 64, 20 / 32, 1, 1, 1, 1,
			-0.30, -0.125, 0.05, 48 / 64, 20 / 32, 1, 1, 1, 1,

		];

		buffer = this.playerRightArm = gl.createBuffer();
		buffer.vertices = vertices.length / 9;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);

		vertices = [
			// Left leg

			// Top
			0.01, -0.125, 0, 4 / 64, 16 / 32, 1, 1, 1, 1,
			0.3, -0.125, 0, 8 / 64, 16 / 32, 1, 1, 1, 1,
			0.3, 0.125, 0, 8 / 64, 20 / 32, 1, 1, 1, 1,
			0.3, 0.125, 0, 8 / 64, 20 / 32, 1, 1, 1, 1,
			0.01, 0.125, 0, 4 / 64, 20 / 32, 1, 1, 1, 1,
			0.01, -0.125, 0, 4 / 64, 16 / 32, 1, 1, 1, 1,

			// Bottom
			0.01, -0.125, -0.73, 8 / 64, 16 / 32, 1, 1, 1, 1,
			0.01, 0.125, -0.73, 8 / 64, 20 / 32, 1, 1, 1, 1,
			0.3, 0.125, -0.73, 12 / 64, 20 / 32, 1, 1, 1, 1,
			0.3, 0.125, -0.73, 12 / 64, 20 / 32, 1, 1, 1, 1,
			0.3, -0.125, -0.73, 12 / 64, 16 / 32, 1, 1, 1, 1,
			0.01, -0.125, -0.73, 8 / 64, 16 / 32, 1, 1, 1, 1,

			// Front		
			0.01, -0.125, 0, 4 / 64, 20 / 32, 1, 1, 1, 1,
			0.01, -0.125, -0.73, 4 / 64, 32 / 32, 1, 1, 1, 1,
			0.3, -0.125, -0.73, 8 / 64, 32 / 32, 1, 1, 1, 1,
			0.3, -0.125, -0.73, 8 / 64, 32 / 32, 1, 1, 1, 1,
			0.3, -0.125, 0, 8 / 64, 20 / 32, 1, 1, 1, 1,
			0.01, -0.125, 0, 4 / 64, 20 / 32, 1, 1, 1, 1,

			// Rear		
			0.01, 0.125, 0, 12 / 64, 20 / 32, 1, 1, 1, 1,
			0.3, 0.125, 0, 16 / 64, 20 / 32, 1, 1, 1, 1,
			0.3, 0.125, -0.73, 16 / 64, 32 / 32, 1, 1, 1, 1,
			0.3, 0.125, -0.73, 16 / 64, 32 / 32, 1, 1, 1, 1,
			0.01, 0.125, -0.73, 12 / 64, 32 / 32, 1, 1, 1, 1,
			0.01, 0.125, 0, 12 / 64, 20 / 32, 1, 1, 1, 1,

			// Right
			0.01, -0.125, 0, 8 / 64, 20 / 32, 1, 1, 1, 1,
			0.01, 0.125, 0, 12 / 64, 20 / 32, 1, 1, 1, 1,
			0.01, 0.125, -0.73, 12 / 64, 32 / 32, 1, 1, 1, 1,
			0.01, 0.125, -0.73, 12 / 64, 32 / 32, 1, 1, 1, 1,
			0.01, -0.125, -0.73, 8 / 64, 32 / 32, 1, 1, 1, 1,
			0.01, -0.125, 0, 8 / 64, 20 / 32, 1, 1, 1, 1,

			// Left
			0.3, -0.125, 0, 4 / 64, 20 / 32, 1, 1, 1, 1,
			0.3, -0.125, -0.73, 4 / 64, 32 / 32, 1, 1, 1, 1,
			0.3, 0.125, -0.73, 0 / 64, 32 / 32, 1, 1, 1, 1,
			0.3, 0.125, -0.73, 0 / 64, 32 / 32, 1, 1, 1, 1,
			0.3, 0.125, 0, 0 / 64, 20 / 32, 1, 1, 1, 1,
			0.3, -0.125, 0, 4 / 64, 20 / 32, 1, 1, 1, 1,
		];

		buffer = this.playerLeftLeg = gl.createBuffer();
		buffer.vertices = vertices.length / 9;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);

		vertices = [
			// Right leg

			// Top
			-0.3, -0.125, 0, 4 / 64, 16 / 32, 1, 1, 1, 1,
			-0.01, -0.125, 0, 8 / 64, 16 / 32, 1, 1, 1, 1,
			-0.01, 0.125, 0, 8 / 64, 20 / 32, 1, 1, 1, 1,
			-0.01, 0.125, 0, 8 / 64, 20 / 32, 1, 1, 1, 1,
			-0.3, 0.125, 0, 4 / 64, 20 / 32, 1, 1, 1, 1,
			-0.3, -0.125, 0, 4 / 64, 16 / 32, 1, 1, 1, 1,

			// Bottom
			-0.3, -0.125, -0.73, 8 / 64, 16 / 32, 1, 1, 1, 1,
			-0.3, 0.125, -0.73, 8 / 64, 20 / 32, 1, 1, 1, 1,
			-0.01, 0.125, -0.73, 12 / 64, 20 / 32, 1, 1, 1, 1,
			-0.01, 0.125, -0.73, 12 / 64, 20 / 32, 1, 1, 1, 1,
			-0.01, -0.125, -0.73, 12 / 64, 16 / 32, 1, 1, 1, 1,
			-0.3, -0.125, -0.73, 8 / 64, 16 / 32, 1, 1, 1, 1,

			// Front		
			-0.3, -0.125, 0, 4 / 64, 20 / 32, 1, 1, 1, 1,
			-0.3, -0.125, -0.73, 4 / 64, 32 / 32, 1, 1, 1, 1,
			-0.01, -0.125, -0.73, 8 / 64, 32 / 32, 1, 1, 1, 1,
			-0.01, -0.125, -0.73, 8 / 64, 32 / 32, 1, 1, 1, 1,
			-0.01, -0.125, 0, 8 / 64, 20 / 32, 1, 1, 1, 1,
			-0.3, -0.125, 0, 4 / 64, 20 / 32, 1, 1, 1, 1,

			// Rear		
			-0.3, 0.125, 0, 16 / 64, 20 / 32, 1, 1, 1, 1,
			-0.01, 0.125, 0, 12 / 64, 20 / 32, 1, 1, 1, 1,
			-0.01, 0.125, -0.73, 12 / 64, 32 / 32, 1, 1, 1, 1,
			-0.01, 0.125, -0.73, 12 / 64, 32 / 32, 1, 1, 1, 1,
			-0.3, 0.125, -0.73, 16 / 64, 32 / 32, 1, 1, 1, 1,
			-0.3, 0.125, 0, 16 / 64, 20 / 32, 1, 1, 1, 1,

			// Right
			-0.3, -0.125, 0, 4 / 64, 20 / 32, 1, 1, 1, 1,
			-0.3, 0.125, 0, 0 / 64, 20 / 32, 1, 1, 1, 1,
			-0.3, 0.125, -0.73, 0 / 64, 32 / 32, 1, 1, 1, 1,
			-0.3, 0.125, -0.73, 0 / 64, 32 / 32, 1, 1, 1, 1,
			-0.3, -0.125, -0.73, 4 / 64, 32 / 32, 1, 1, 1, 1,
			-0.3, -0.125, 0, 4 / 64, 20 / 32, 1, 1, 1, 1,

			// Left
			-0.01, -0.125, 0, 8 / 64, 20 / 32, 1, 1, 1, 1,
			-0.01, -0.125, -0.73, 8 / 64, 32 / 32, 1, 1, 1, 1,
			-0.01, 0.125, -0.73, 12 / 64, 32 / 32, 1, 1, 1, 1,
			-0.01, 0.125, -0.73, 12 / 64, 32 / 32, 1, 1, 1, 1,
			-0.01, 0.125, 0, 12 / 64, 20 / 32, 1, 1, 1, 1,
			-0.01, -0.125, 0, 8 / 64, 20 / 32, 1, 1, 1, 1
		];

		buffer = this.playerRightLeg = gl.createBuffer();
		buffer.vertices = vertices.length / 9;
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
	}

	// Cleanup method to release WebGL resources
	cleanup() {
		const gl = this.gl;

		// Delete shaders
		gl.deleteProgram(this.program);

		// Delete textures
		gl.deleteTexture(this.texWhite);
		gl.deleteTexture(this.texPlayer);
		gl.deleteTexture(this.texTerrain);

		// Delete buffers
		if (this.playerHead) gl.deleteBuffer(this.playerHead);
		if (this.playerBody) gl.deleteBuffer(this.playerBody);
		if (this.playerLeftArm) gl.deleteBuffer(this.playerLeftArm);
		if (this.playerRightArm) gl.deleteBuffer(this.playerRightArm);
		if (this.playerLeftLeg) gl.deleteBuffer(this.playerLeftLeg);
		if (this.playerRightLeg) gl.deleteBuffer(this.playerRightLeg);

		// Delete chunk buffers
		if (this.chunks) {
			for (const chunk of this.chunks) {
				if (chunk.buffer) gl.deleteBuffer(chunk.buffer);
			}
		}

		 // Also clean up player nametags
		 if (this.world && this.world.players) {
			for (const player of Object.values(this.world.players)) {
				if (player.nametag) {
					gl.deleteTexture(player.nametag.texture);
					gl.deleteBuffer(player.nametag.model);
					delete player.nametag;
				}
			}
		}

		// Remove text canvas
		if (this.textCanvas && this.textCanvas.parentNode) {
			this.textCanvas.parentNode.removeChild(this.textCanvas);
		}

		// Clear references
		this.world = null;
		this.chunks = null;
		this.canvas.renderer = null;
		this.canvas = null;
	}

	// Add new methods for context handling
	handleContextLost() {
		this.contextLost = true;
		// Cancel any pending renders
	}

	handleContextRestored() {
		this.contextLost = false;
		// Reload resources and reinitialize WebGL state
		this.loadShaders();
		this.loadPlayerHeadModel();
		this.loadPlayerBodyModel();
		// Rebuild chunks
		if (this.chunks) {
			this.chunks.forEach(chunk => chunk.dirty = true);
		}
	}

	// Update frustum planes based on the current view and projection matrices
	updateFrustumPlanes() {
		const m = mat4.create();
		mat4.multiply(m, this.projMatrix, this.viewMatrix);

		// Left plane
		vec4.set(this.frustumPlanes[0], m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]);
		vec4.normalize(this.frustumPlanes[0], this.frustumPlanes[0]);

		// Right plane
		vec4.set(this.frustumPlanes[1], m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]);
		vec4.normalize(this.frustumPlanes[1], this.frustumPlanes[1]);

		// Bottom plane
		vec4.set(this.frustumPlanes[2], m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]);
		vec4.normalize(this.frustumPlanes[2], this.frustumPlanes[2]);

		// Top plane
		vec4.set(this.frustumPlanes[3], m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]);
		vec4.normalize(this.frustumPlanes[3], this.frustumPlanes[3]);

		// Near plane
		vec4.set(this.frustumPlanes[4], m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]);
		vec4.normalize(this.frustumPlanes[4], this.frustumPlanes[4]);

		// Far plane
		vec4.set(this.frustumPlanes[5], m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]);
		vec4.normalize(this.frustumPlanes[5], this.frustumPlanes[5]);
	}

	// Check if a chunk is within the view frustum
	isChunkInFrustum(chunk) {
		const start = chunk.start;
		const end = chunk.end;

		for (let i = 0; i < 6; i++) {
			const plane = this.frustumPlanes[i];
			if (vec4.dot(plane, vec4.fromValues(start[0], start[1], start[2], 1)) < 0 &&
				vec4.dot(plane, vec4.fromValues(end[0], start[1], start[2], 1)) < 0 &&
				vec4.dot(plane, vec4.fromValues(start[0], end[1], start[2], 1)) < 0 &&
				vec4.dot(plane, vec4.fromValues(end[0], end[1], start[2], 1)) < 0 &&
				vec4.dot(plane, vec4.fromValues(start[0], start[1], end[2], 1)) < 0 &&
				vec4.dot(plane, vec4.fromValues(end[0], start[1], end[2], 1)) < 0 &&
				vec4.dot(plane, vec4.fromValues(start[0], end[1], end[2], 1)) < 0 &&
				vec4.dot(plane, vec4.fromValues(end[0], end[1], end[2], 1)) < 0) {
				return false;
			}
		}
		return true;
	}

	// Check if a chunk is within the view frustum and visible
	isChunkVisible(chunk) {
		 // Remove distance check temporarily to ensure chunks are built
		 return true;
	}

	// Add texture load tracking
	handleTextureLoad() {
		this.texturesLoaded++;
		if (this.texturesLoaded === this.totalTextures) {
			// All textures loaded
			this.readyToRender = true;
		}
	}

	// Event queue for renderer notifications

	eventQueue = [];

	processEvents() {
		while (this.eventQueue.length > 0) {
			const event = this.eventQueue.shift();
			if (event.type === 'blockChanged') {
				this.buildChunks(1);
			}
		}
	}
}