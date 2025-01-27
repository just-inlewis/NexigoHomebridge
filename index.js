const net = require("net");
const dns = require("dns");

let Service, Characteristic;

// Simple input map for demonstration
const inputMap = {
  1: "Menu",
  2: "Apple TV",
  3: "PlayStation",
};

module.exports = (homebridge) => {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerAccessory(
    "homebridge-television-remote",
    TelevisionAccessory
  );
};

function TelevisionAccessory(log, config) {
  this.log = log;
  this.config = config;
  this.name = config.name || "Projector";
  if (!config.hostname) {
    this.log.error("Configuration Error: 'hostname' is required.");
    throw new Error("Missing required configuration: 'hostname'");
  }
  this.hostname = config.hostname;
  if (
    config.port === undefined ||
    config.port === null ||
    !Number.isInteger(config.port) ||
    config.port <= 0 ||
    config.port > 65535
  ) {
    this.log.error("Configuration Error: 'port' must be a valid integer between 1 and 65535.");
    throw new Error("Invalid or missing configuration: 'port'");
  }
  this.port = config.port;
  this.enabledServices = [];
  this.isCurrentlyPlaying = false;

  this.sendKeyEvent = async (keys, callback) => {
    const sendSingleKeyEvent = (key) => {
      return new Promise((resolve, reject) => {
        const message = `KEYEVENT\r\n${key}\r\n`;
        this.log(`SENDING: ${message.trim()} -> ${this.hostname}:${this.port}`);
        const client = net.createConnection({ host: this.hostname, port: this.port }, () => {
          client.write(message);
          client.end();
        });
        client.on("error", (err) => {
          this.log.error(`Error sending key event to ${this.hostname}:${this.port} => ${err.message}`);
          reject(err);
        });
        client.on("close", () => {
          resolve();
        });
      });
    };
  
    if (!Array.isArray(keys)) {
      keys = [keys];
    }
  
    try {
      for (let i = 0; i < keys.length; i++) {
        await sendSingleKeyEvent(keys[i]);
        if (i < keys.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      this.log(`All keys sent successfully to ${this.hostname}:${this.port}`);
      if (callback) callback(null, true);
    } catch (error) {
      this.log.error(`Failed to send keys to ${this.hostname}:${this.port}: ${error.message}`);
      if (callback) callback(error, false);
    }
  };
  
  /**
   * Television Service
   */
  this.tvService = new Service.Television(this.name, "Projector");
  this.tvService.setCharacteristic(Characteristic.ConfiguredName, this.name);
  this.tvService.setCharacteristic(
    Characteristic.SleepDiscoveryMode,
    Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE
  );

  // ---------------------------------------------------------
  //  Power: Always ON, do nothing when toggled
  // ---------------------------------------------------------
  this.tvService
    .getCharacteristic(Characteristic.Active)
    .on("get", (callback) => {
      // Always report ON
      this.log.debug("getCharacteristic(Active) => Always ON");
      callback(null, 1); // 1 => Active.ON
    })
    .on("set", (value, callback) => {
      // Do nothing when user toggles
      this.log.debug("setCharacteristic(Active) => ignoring power toggle to " + value);
      callback(null);
    });

  // ---------------------------------------------------------
  // Default active input = 1
  // ---------------------------------------------------------
  this.tvService.setCharacteristic(Characteristic.ActiveIdentifier, 1);

  // ---------------------------------------------------------
  // Handle input selection
  // ---------------------------------------------------------
  this.tvService
    .getCharacteristic(Characteristic.ActiveIdentifier)
    .on("set", (newValue, callback) => {
      const inputName = inputMap[newValue];
      this.log("INPUT: Switching to =>", inputName);
      switch (newValue) {
        case 1:
          this.sendKeyEvent(3, (err, success) => {
            callback(err);
          });
        case 2:
          this.sendKeyEvent([178, 21, 21, 21, 22, 66], (err, success) => {
            callback(err);
          });
          break;
        case 3:
          this.sendKeyEvent([178, 21, 21, 21, 22, 22, 66], (err, success) => {
            callback(err);
          });
          break;
      }
    });

  // ---------------------------------------------------------
  // RemoteKey => arrow keys, play/pause, back, etc.
  // ---------------------------------------------------------
  this.tvService
    .getCharacteristic(Characteristic.RemoteKey)
    .on("set", (newValue, callback) => {
      this.log.debug("Remote key pressed:", newValue);
      switch (newValue) {
        case Characteristic.RemoteKey.ARROW_UP:
          this.log("REMOTE: Up");
          this.sendKeyEvent(19, (err, success) => {
            callback(err);
          });
          break;
        case Characteristic.RemoteKey.ARROW_DOWN:
          this.log("REMOTE: Down");
          this.sendKeyEvent(20, (err, success) => {
            callback(err);
          });
          break;
        case Characteristic.RemoteKey.ARROW_LEFT:
          this.log("REMOTE: Left");
          this.sendKeyEvent(21, (err, success) => {
            callback(err);
          });
          break;
        case Characteristic.RemoteKey.ARROW_RIGHT:
          this.log("REMOTE: Right");
          this.sendKeyEvent(22, (err, success) => {
            callback(err);
          });
          break;
        case Characteristic.RemoteKey.SELECT:
          this.log("REMOTE: Select");
          this.sendKeyEvent(66, (err, success) => {
            callback(err);
          });
          break;
        case Characteristic.RemoteKey.BACK:
          this.log("REMOTE: Back");
          this.sendKeyEvent(4, (err, success) => {
            callback(err);
          });
          break;
        case Characteristic.RemoteKey.PLAY_PAUSE:
          if (this.isCurrentlyPlaying) {
            this.log("REMOTE: Pause");
            this.sendKeyEvent(127, (err, success) => {
              callback(err);
            });
            this.isCurrentlyPlaying = false;
          } else {
            this.log("REMOTE: Play");
            this.sendKeyEvent(126, (err, success) => {
              callback(err);
            });
            this.isCurrentlyPlaying = true;
          }
          break;
        case Characteristic.RemoteKey.INFORMATION:
          this.log("REMOTE: Menu");
          this.sendKeyEvent(82, (err, success) => {
            callback(err);
          });
          break;
        default:
          this.log("REMOTE: Unhandled key =>", newValue);
          callback();
      }
    });

  this.inputMenuService = createInputSource("menu", "Menu", 1, Characteristic.InputSourceType.OTHER);
  this.inputHDMI1Service = createInputSource("hdmi1", "Apple TV", 2, Characteristic.InputSourceType.HDMI);
  this.inputHDMI2Service = createInputSource("hdmi2", "PlayStation", 3, Characteristic.InputSourceType.HDMI);

  // Link them
  this.tvService.addLinkedService(this.inputMenuService);
  this.tvService.addLinkedService(this.inputHDMI1Service);
  this.tvService.addLinkedService(this.inputHDMI2Service);

  /**
   * Speaker Service => volume, mute
   */
  this.speakerService = new Service.TelevisionSpeaker(`${this.name} Speaker`, "TelevisionSpeaker");
  this.speakerService
    .setCharacteristic(Characteristic.Active, Characteristic.Active.ACTIVE)
    .setCharacteristic(Characteristic.VolumeControlType, Characteristic.VolumeControlType.RELATIVE);

  // Mute
  this.speakerService
  .getCharacteristic(Characteristic.Mute)
  .on("set", (newValue, callback) => {
    this.log("SPEAKER: Mute");
    this.sendKeyEvent(164, (err, success) => {
      callback(err);
    });
  });

  // Volume up/down
  this.speakerService
    .getCharacteristic(Characteristic.VolumeSelector)
    .on("set", (newValue, callback) => {
      // 0 => up, 1 => down
      if (newValue === 0) {
        this.log("SPEAKER: Volume Up");
        this.sendKeyEvent(24, (err, success) => {
          callback(err);
        });
      } else {
        this.log("SPEAKER: Volume Down");
        this.sendKeyEvent(25, (err, success) => {
          callback(err);
        });
      }
    });

  // Add everything to the accessory
  this.tvService.addLinkedService(this.speakerService);
  this.enabledServices.push(this.tvService);
  this.enabledServices.push(this.inputMenuService);
  this.enabledServices.push(this.inputHDMI1Service);
  this.enabledServices.push(this.inputHDMI2Service);
  this.enabledServices.push(this.speakerService);
}

// Return all services
TelevisionAccessory.prototype.getServices = function () {
  return this.enabledServices;
};

// Helper: Create InputSource
function createInputSource(id, name, number, type) {
  const inputService = new Service.InputSource(id, name);
  inputService
    .setCharacteristic(Characteristic.Identifier, number)
    .setCharacteristic(Characteristic.ConfiguredName, name)
    .setCharacteristic(Characteristic.IsConfigured, Characteristic.IsConfigured.CONFIGURED)
    .setCharacteristic(Characteristic.InputSourceType, type);
  return inputService;
}