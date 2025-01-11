// ==========================================
// Network
//
// This class manages the connection between the client and the
// server and everything involved.
// ==========================================

// ==========================================
// Client
// ==========================================

// Constructor( socketio )
//
// Creates a new client using the specified socket interface.

import { Vector } from './helpers.js'; // Ensure Vector is imported

export class Client {
	constructor(socketio) {
		this.io = socketio;
		this.eventHandlers = {};
		this.kicked = false;
	}

	// connect( uri, nickname )
	//
	// Connect to a server with the specified nickname.

	connect(uri, nickname) {
		this.socket = this.io.connect(uri, { reconnect: false });
		this.nickname = nickname;

		// Hook events
		this.socket.on("connect", () => this.onConnection());
		this.socket.on("disconnect", () => this.onDisconnection());
		this.socket.on("world", (data) => this.onWorld(data));
		this.socket.on("spawn", (data) => this.onSpawn(data));
		this.socket.on("setblock", (data) => this.onBlockUpdate(data));
		this.socket.on("msg", (data) => this.onMessage(data));
		this.socket.on("kick", (data) => this.onKick(data));
		this.socket.on("join", (data) => this.onPlayerJoin(data));
		this.socket.on("leave", (data) => this.onPlayerLeave(data));
		this.socket.on("player", (data) => this.onPlayerUpdate(data));
		this.socket.on("setpos", (data) => this.onPlayerSetPos(data));
	}

	// setBlock( x, y, z, mat )
	//
	// Called to do a networked block update.

	setBlock(x, y, z, mat) {
		this.socket.emit("setblock", {
			x,
			y,
			z,
			mat: mat.id,
		});
	}

	// sendMessage( msg )
	//
	// Send a chat message.

	sendMessage(msg) {
		this.socket.emit("chat", { msg });
	}

	// updatePlayer()
	//
	// Sends the current player position and orientation to the server.

	updatePlayer() {
		if (!this.world || !this.world.localPlayer) return; // Ensure localPlayer is defined

		const player = this.world.localPlayer;

		this.socket.emit("player", {
			x: player.pos.x,
			y: player.pos.y,
			z: player.pos.z,
			pitch: player.angles[0],
			yaw: player.angles[1],
		});
	}

	// on( event, callback )
	//
	// Hooks an event.

	on(event, callback) {
		this.eventHandlers[event] = callback;
	}

	// onConnection()
	//
	// Called when the client has connected.

	onConnection() {
		if (this.eventHandlers["connect"]) this.eventHandlers.connect();

		this.socket.emit("nickname", { nickname: this.nickname });
	}

	// onDisconnection()
	//
	// Called when the client was disconnected.

	onDisconnection() {
		if (this.eventHandlers["disconnect"]) this.eventHandlers.disconnect(this.kicked);
	}

	// onWorld( data )
	//
	// Called when the server has sent the world.

	onWorld(data) {
		console.log("Received world data:", data); // Add logging
		console.log("Creating world with dimensions:", data.sx, data.sy, data.sz); // Add logging
		// Create world from string representation
		this.world = new World(data.sx, data.sy, data.sz);
		this.world.createFromString(data.blocks);
		console.log("World created successfully"); // Add logging

		if (this.eventHandlers["world"]) this.eventHandlers.world(this.world);
	}

	// onSpawn( data )
	//
	// Called when the local player is spawned.

	onSpawn(data) {
		// Set spawn point
		this.world.spawnPoint = new Vector(data.x, data.y, data.z);

		if (this.eventHandlers["spawn"]) this.eventHandlers.spawn();
	}

	// onBlockUpdate( data )
	//
	// Called when a block update is received from the server.

	onBlockUpdate(data) {
		const material = BLOCK.fromId(data.mat);

		if (this.eventHandlers["block"])
			this.eventHandlers.block(
				data.x,
				data.y,
				data.z,
				this.world.blocks[data.x][data.y][data.z],
				material
			);

		this.world.setBlock(data.x, data.y, data.z, material);
	}

	// onMessage( data )
	//
	// Called when a message is received.

	onMessage(data) {
		if (data.type === "chat") {
			if (this.eventHandlers["chat"]) this.eventHandlers.chat(data.user, data.msg);
		} else if (data.type === "generic") {
			if (this.eventHandlers["message"]) this.eventHandlers.message(data.msg);
		}
	}

	// onKick( data )
	//
	// Called when a kick message is received.

	onKick(data) {
		this.kicked = true;
		if (this.eventHandlers["kick"]) this.eventHandlers.kick(data.msg);
	}

	// onPlayerJoin( data )
	//
	// Called when a new player joins the game.

	onPlayerJoin(data) {
		data.moving = false;
		data.aniframe = 0;
		this.world.players[data.nick] = data;
	}

	// onPlayerLeave( data )
	//
	// Called when a player has left the game.

	onPlayerLeave(data) {
		if (this.world.players[data.nick].nametag) {
			this.world.renderer.gl.deleteBuffer(this.world.players[data.nick].nametag.model);
			this.world.renderer.gl.deleteTexture(this.world.players[data.nick].nametag.texture);
		}

		delete this.world.players[data.nick];
	}

	// onPlayerUpdate( data )
	//
	// Called when the server has sent updated player info.

	onPlayerUpdate(data) {
		if (!this.world) return;

		const pl = this.world.players[data.nick];
		if (
			Math.abs(data.x - pl.x) > 0.1 ||
			Math.abs(data.y - pl.y) > 0.1 ||
			Math.abs(data.z - pl.z) > 0.1
		) {
			pl.moving = true;
		}

		pl.x = data.x;
		pl.y = data.y;
		pl.z = data.z;
		pl.pitch = data.pitch;
		pl.yaw = data.yaw;
		setTimeout(() => {
			pl.moving = false;
		}, 100);
	}

	// onPlayerSetPos( data )
	//
	// Called when the server wants to set the position of the local player.

	onPlayerSetPos(data) {
		this.world.localPlayer.pos = new Vector(data.x, data.y, data.z);
		this.world.localPlayer.velocity = new Vector(0, 0, 0);
	}
}

// ==========================================
// Server
// ==========================================

// Constructor( socketio, slots )
//
// Creates a new server listening for clients using the specified
// socket interface. Slots is an optional maximum amount of clients.

function Server(socketio, slots) {
	const express = require("express");
	const app = express();
	const http = require("http").Server(app);
	app.use(express.static("."));

	this.io = socketio(http);
	this.eventHandlers = {};
	this.activeNicknames = {};
	this.activeAddresses = {};
	this.maxSlots = slots;
	this.usedSlots = 0;
	this.oneUserPerIp = true;

	this.io.sockets.on("connection", (socket) => this.onConnection(socket));
	http.listen(3000, () => {});
}

// setWorld( world )
//
// Assign a world to be networked.

Server.prototype.setWorld = function (world) {
	this.world = world;
};

// setLogger( fn )
//
// Assign a log function to output activity to.

Server.prototype.setLogger = function (fn) {
	this.log = fn;
};

// setOneUserPerIp( enabled )
//
// Enable/disable the one user per ip rule.

Server.prototype.setOneUserPerIp = function (enabled) {
	this.oneUserPerIp = enabled;
};

// on( event, callback )
//
// Hooks an event.

Server.prototype.on = function (event, callback) {
	this.eventHandlers[event] = callback;
};

// sendMessage( msg[, socket] )
//
// Send a generic message to a certain client or everyone.

Server.prototype.sendMessage = function (msg, socket) {
	const obj = socket || this.io.sockets;
	obj.emit("msg", { type: "generic", msg });
};

// broadcastMessage( msg, socket )
//
// Send a generic message to everyone except for the
// specified client.

Server.prototype.broadcastMessage = function (msg, socket) {
	socket.broadcast.emit("msg", { type: "generic", msg });
};

// kick( socket, msg )
//
// Kick a client with the specified message.

Server.prototype.kick = function (socket, msg) {
	if (this.log) this.log(`Client ${this.getIp(socket)} was kicked (${msg}).`);

	if (socket._nickname != null) this.sendMessage(`${socket._nickname} was kicked (${msg}).`);

	socket.emit("kick", { msg });
	socket.disconnect();
};

// setPos( socket, x, y, z )
//
// Request a client to change their position.

Server.prototype.setPos = function (socket, x, y, z) {
	socket.emit("setpos", { x, y, z });
};

// findPlayerByName( name )
//
// Attempts to find a player by their nickname.

Server.prototype.findPlayerByName = function (name) {
	for (const p in this.world.players)
		if (p.toLowerCase().includes(name.toLowerCase())) return this.world.players[p];
	return null;
};

// onConnection( socket )
//
// Called when a new client has connected.

Server.prototype.onConnection = function (socket) {
	if (this.log) this.log(`Client ${this.getIp(socket)} connected to the server.`);

	// Check if a slot limit is active
	if (this.maxSlots != null && this.usedSlots === this.maxSlots) {
		this.kick(socket, "The server is full!");
		return;
	}

	// Prevent people from blocking the server with multiple open clients
	if (this.activeAddresses[this.getIp(socket)] && this.oneUserPerIp) {
		this.kick(socket, "Multiple clients connecting from the same IP address!");
		return;
	}
	this.activeAddresses[this.getIp(socket)] = true;
	this.usedSlots++;

	// Hook events
	socket.on("nickname", (data) => this.onNickname(socket, data));
	socket.on("setblock", (data) => this.onBlockUpdate(socket, data));
	socket.on("chat", (data) => this.onChatMessage(socket, data));
	socket.on("player", (data) => this.onPlayerUpdate(socket, data));
	socket.on("disconnect", () => this.onDisconnect(socket));
};

// onNickname( socket, nickname )
//
// Called when a client has sent their nickname.

Server.prototype.onNickname = function (socket, data) {
	if (data.nickname.length === 0 || data.nickname.length > 15) return false;

	// Prevent people from changing their username
	if (socket._nickname == null) {
		const nickname = this.sanitiseInput(data.nickname);

		for (const n in this.activeNicknames) {
			if (n.toLowerCase() === nickname.toLowerCase()) {
				this.kick(socket, "That username is already in use!");
				return;
			}
		}

		if (this.log) this.log(`Client ${this.getIp(socket)} is now known as ${nickname}.`);
		if (this.eventHandlers["join"]) this.eventHandlers.join(socket, nickname);
		this.activeNicknames[data.nickname] = true;

		// Associate nickname with socket
		socket._nickname = nickname;

		// Send world to client
		const world = this.world;

		socket.emit("world", {
			sx: world.sx,
			sy: world.sy,
			sz: world.sz,
			blocks: world.toNetworkString(),
		});

		// Spawn client
		socket.emit("spawn", {
			x: world.spawnPoint.x,
			y: world.spawnPoint.y,
			z: world.spawnPoint.z,
		});

		// Tell client about other players
		for (const p in this.world.players) {
			const pl = this.world.players[p];

			socket.emit("join", {
				nick: p,
				x: pl.x,
				y: pl.y,
				z: pl.z,
				pitch: pl.pitch,
				yaw: pl.yaw,
			});
		}

		// Inform other players
		socket.broadcast.emit("join", {
			nick: nickname,
			x: world.spawnPoint.x,
			y: world.spawnPoint.y,
			z: world.spawnPoint.z,
			pitch: 0,
			yaw: 0,
		});

		// Add player to world
		world.players[nickname] = {
			socket,
			nick: nickname,
			lastBlockCheck: +new Date(),
			blocks: 0,
			x: world.spawnPoint.x,
			y: world.spawnPoint.y,
			z: world.spawnPoint.z,
			pitch: 0,
			yaw: 0,
		};
	}
};

// onBlockUpdate( socket, data )
//
// Called when a client wants to change a block.

Server.prototype.onBlockUpdate = function (socket, data) {
	const world = this.world;

	if (
		typeof data.x !== "number" ||
		typeof data.y !== "number" ||
		typeof data.z !== "number" ||
		typeof data.mat !== "number"
	)
		return false;
	if (data.x < 0 || data.y < 0 || data.z < 0 || data.x >= world.sx || data.y >= world.sy || data.z >= world.sz)
		return false;
	if (
		Math.sqrt(
			(data.x - world.spawnPoint.x) ** 2 +
			(data.y - world.spawnPoint.y) ** 2 +
			(data.z - world.spawnPoint.z) ** 2
		) < 10
	)
		return false;

	const material = BLOCK.fromId(data.mat);
	if (material == null || (!material.spawnable && data.mat !== 0)) return false;

	// Check if the user has authenticated themselves before allowing them to set blocks
	if (socket._nickname != null) {
		try {
			world.setBlock(data.x, data.y, data.z, material);

			const pl = this.world.players[socket._nickname];
			pl.blocks++;
			if (+new Date() > pl.lastBlockCheck + 100) {
				if (pl.blocks > 5) {
					this.kick(socket, "Block spamming.");
					return;
				}

				pl.lastBlockCheck = +new Date();
				pl.blocks = 0;
			}

			this.io.sockets.emit("setblock", {
				x: data.x,
				y: data.y,
				z: data.z,
				mat: data.mat,
			});
		} catch (e) {
			console.log(`Error setting block at ( ${data.x}, ${data.y}, ${data.z} ): ${e}`);
		}
	}
};

// onChatMessage( socket, data )
//
// Called when a client sends a chat message.

Server.prototype.onChatMessage = function (socket, data) {
	if (typeof data.msg !== "string" || data.msg.trim().length === 0 || data.msg.length > 100) return false;
	const msg = this.sanitiseInput(data.msg);

	// Check if the user has authenticated themselves before allowing them to send messages
	if (socket._nickname != null) {
		if (this.log) this.log(`<${socket._nickname}> ${msg}`);

		let callback = false;
		if (this.eventHandlers["chat"]) callback = this.eventHandlers.chat(socket, socket._nickname, msg);

		if (!callback) {
			this.io.sockets.emit("msg", {
				type: "chat",
				user: socket._nickname,
				msg,
			});
		}
	}
};

// onPlayerUpdate( socket, data )
//
// Called when a client sends a position/orientation update.

function normaliseAngle(ang) {
	ang %= Math.PI * 2;
	if (ang < 0) ang = Math.PI * 2 + ang;
	return ang;
}

Server.prototype.onPlayerUpdate = function (socket, data) {
	if (typeof data.x !== "number" || typeof data.y !== "number" || typeof data.z !== "number") return false;
	if (typeof data.pitch !== "number" || typeof data.yaw !== "number") return false;

	// Check if the user has authenticated themselves before allowing them to send updates
	if (socket._nickname != null) {
		const pl = this.world.players[socket._nickname];
		pl.x = data.x;
		pl.y = data.y;
		pl.z = data.z;
		pl.pitch = data.pitch;
		pl.yaw = data.yaw;

		// Forward update to other players
		for (const p in this.world.players) {
			const tpl = this.world.players[p];
			if (tpl.socket === socket) continue;

			const ang = Math.PI + Math.atan2(tpl.y - pl.y, tpl.x - pl.x);
			const nyaw = Math.PI - tpl.yaw - Math.PI / 2;
			const inFrustrum = Math.abs(normaliseAngle(nyaw) - normaliseAngle(ang)) < Math.PI / 2;

			if (inFrustrum) {
				tpl.socket.volatile.emit("player", {
					nick: socket._nickname,
					x: pl.x,
					y: pl.y,
					z: pl.z,
					pitch: pl.pitch,
					yaw: pl.yaw,
				});
			}
		}
	}
};

// onDisconnect( socket, data )
//
// Called when a client has disconnected.

Server.prototype.onDisconnect = function (socket) {
	if (this.log) this.log(`Client ${this.getIp(socket)} disconnected.`);

	this.usedSlots--;
	delete this.activeAddresses[this.getIp(socket)];

	if (socket._nickname != null) {
		delete this.activeNicknames[socket._nickname];
		delete this.world.players[socket._nickname];

		// Inform other players
		socket.broadcast.emit("leave", {
			nick: socket._nickname,
		});

		if (this.eventHandlers["leave"]) this.eventHandlers.leave(socket._nickname);
	}
};

// sanitiseInput( str )
//
// Prevents XSS exploits and other bad things.

Server.prototype.sanitiseInput = function (str) {
	return str.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\\/g, "&quot;");
};

Server.prototype.getIp = function (socket) {
	return socket.request.connection.remoteAddress;
};

// connectToServer( uri, slots )
//
// Connect to a server with the specified URI and slots.

export function connectToServer(uri, slots) {
	const socketio = require("socket.io-client");
	const server = new Server(socketio, slots);
	server.setLogger(console.log);
	server.setWorld(new World(100, 100, 100)); // Example world dimensions
	server.setOneUserPerIp(true);

	const client = new Client(socketio);
	client.connect(uri, "PlayerNickname"); // Connect to the specified URL with example nickname

	server.io.listen(3000); // Start the server
}

// Export to node.js
if (typeof exports !== "undefined") {
	exports.Server = Server;
}
