'use strict';

var _values = require('babel-runtime/core-js/object/values');

var _values2 = _interopRequireDefault(_values);

var _keys = require('babel-runtime/core-js/object/keys');

var _keys2 = _interopRequireDefault(_keys);

var _extends2 = require('babel-runtime/helpers/extends');

var _extends3 = _interopRequireDefault(_extends2);

var _bluebird = require('bluebird');

var _bluebird2 = _interopRequireDefault(_bluebird);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _glob = require('glob');

var _glob2 = _interopRequireDefault(_glob);

var _migration2 = require('./migration');

var _migration3 = _interopRequireDefault(_migration2);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _events = require('events');

var _Storage = require('./storages/Storage');

var _Storage2 = _interopRequireDefault(_Storage);

var _JSONStorage = require('./storages/JSONStorage');

var _JSONStorage2 = _interopRequireDefault(_JSONStorage);

var _MongoDBStorage = require('./storages/MongoDBStorage');

var _MongoDBStorage2 = _interopRequireDefault(_MongoDBStorage);

var _SequelizeStorage = require('./storages/SequelizeStorage');

var _SequelizeStorage2 = _interopRequireDefault(_SequelizeStorage);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * @class Umzug
 * @extends EventEmitter
 */
module.exports = class Umzug extends _events.EventEmitter {
  /**
   * Constructs Umzug instance.
   *
   * @param {Object} [options]
   * @param {String} [options.storage='json'] - The storage. Possible values:
   * 'json', 'sequelize', 'mongodb', an argument for `require()`, including absolute paths.
   * @param {function|false} [options.logging=false] - The logging function.
   * A function that gets executed every time migrations start and have ended.
   * @param {String} [options.upName='up'] - The name of the positive method
   * in migrations.
   * @param {String} [options.downName='down'] - The name of the negative method
   * in migrations.
   * @param {Object} [options.storageOptions] - The options for the storage.
   * Check the available storages for further details.
   * @param {Object|Array} [options.migrations] - options for loading migration
   * files, or an array of options
   * @param {Array} [options.migrations.params] - The params that gets passed to
   * the migrations. Might be an array or a synchronous function which returns
   * an array.
   * @param {String} [options.migrations.path] - The path to the migrations
   * directory.
   * @param {RegExp} [options.migrations.pattern] - The pattern that determines
   * whether or not a file is a migration.
   * @param {Migration~wrap} [options.migrations.wrap] - A function that
   * receives and returns the to be executed function. This can be used to
   * modify the function.
   * @param {Migration~customResolver} [options.migrations.customResolver] - A
   * function that specifies how to get a migration object from a path. This
   * should return an object of the form { up: Function, down: Function }.
   * Without this defined, a regular javascript import will be performed.
   * @param {Object|Array} [options.migrationInstances] - Array of `Migration`
   * instances. This is an advanced use case that bypasses Umzug's normal migration
   * loading logic.
   * @constructs Umzug
   */
  constructor(options = {}) {
    super();

    this.options = (0, _extends3.default)({
      storage: 'json',
      storageOptions: {},
      logging: false,
      upName: 'up',
      downName: 'down'
    }, options);

    if (this.options.logging && typeof this.options.logging !== 'function') {
      throw new Error('The logging-option should be either a function or false');
    }

    if (Array.isArray(this.options.migrations)) {
      if (this.options.migrations[0] instanceof _migration3.default) {
        this.options.migrationInstances = this.options.migrations;
        this.options.migrations = [{}];
      }
    } else {
      this.options.migrations = [this.options.migrations];
    }

    this.options.migrations = this.options.migrations.map(migrationOptions => (0, _extends3.default)({
      params: [],
      path: _path2.default.resolve(process.cwd(), 'migrations'),
      pattern: /^\d+[\w-]+\.js$/,
      traverseDirectories: false,
      wrap: fun => fun
    }, migrationOptions));

    this.storage = {};

    if (Array.isArray(this.options.storage)) {
      for (var i = 0; i < this.options.storage.length; i++) {
        this.storage[this.options.storage[i].type] = this._initStorage(this.options.storage[i].adapter, this.options.storageOptions[i]);
      }
    } else {
      this.storage['default'] = this._initStorage(this.options.storage, this.options.storageOptions);
    }
  }

  /**
   * Executes given migrations with a given method.
   *
   * @param {Object}   [options]
   * @param {String[]} [options.migrations=[]]
   * @param {String}   [options.method='up']
   * @returns {Promise}
   */
  execute(options = {}) {
    const self = this;

    options = (0, _extends3.default)({
      migrations: [],
      method: 'up'
    }, options);

    return _bluebird2.default.map(options.migrations, migration => self._findMigration(migration)).then(migrations => (0, _extends3.default)({}, options, {
      migrations
    })).then(options => _bluebird2.default.each(options.migrations, migration => {
      const name = _path2.default.basename(migration.file, _path2.default.extname(migration.file));
      let startTime;
      return self._wasExecuted(migration).catch(() => false).then(executed => typeof executed === 'undefined' ? true : executed).tap(executed => {
        if (!executed || options.method === 'down') {
          const fun = migration[options.method] || _bluebird2.default.resolve;
          let params = migration.options.params;

          if (typeof params === 'function') {
            params = params();
          }

          var storageType = 'default';

          (0, _keys2.default)(self.storage).forEach(function (key) {
            var regex = new RegExp(`[\/\\\\]${key}`, "g");
            if (migration.path.search(regex) > 0) {
              storageType = key;
            }
          });
          migration.storage = { type: storageType, adapter: this.storage[storageType] };

          if (options.method === 'up') {
            self.log('== ' + name + ': migrating =======');
            self.emit('migrating', name, migration);
          } else {
            self.log('== ' + name + ': reverting =======');
            self.emit('reverting', name, migration);
          }

          startTime = new Date();

          return fun.apply(migration, params);
        }
      }).then(executed => {
        if (!executed && options.method === 'up') {
          return _bluebird2.default.resolve(self.storage[migration.storage.type].logMigration(migration.file));
        } else if (options.method === 'down') {
          return _bluebird2.default.resolve(self.storage[migration.storage.type].unlogMigration(migration.file));
        }
      }).tap(() => {
        const duration = ((new Date() - startTime) / 1000).toFixed(3);
        if (options.method === 'up') {
          self.log('== ' + name + ': migrated (' + duration + 's)\n');
          self.emit('migrated', name, migration);
        } else {
          self.log('== ' + name + ': reverted (' + duration + 's)\n');
          self.emit('reverted', name, migration);
        }
      });
    }));
  }

  /**
   * Lists executed migrations.
   *
   * @returns {Promise.<Migration>}
   */
  executed() {
    return _bluebird2.default.map((0, _values2.default)(this.storage), storage => storage.executed()).then(files => files.toString().split(',')).bind(this).map(file => {
      return new _migration3.default(file);
    });
  }

  /**
   * Lists pending migrations.
   *
   * @returns {Promise.<Migration[]>}
   */
  pending() {
    return this._findMigrations().bind(this).then(function (all) {
      return _bluebird2.default.join(all, this.executed());
    }).spread((all, executed) => {
      const executedFiles = executed.map(migration => migration.file);

      return all.filter(migration => executedFiles.indexOf(migration.file) === -1);
    });
  }

  /**
   * Execute migrations up.
   *
   * If options is a migration name (String), it will be executed.
   * If options is a list of migration names (String[]), them will be executed.
   * If options is Object:
   * - { from: 'migration-1', to: 'migration-n' } - execute migrations in range.
   * - { migrations: [] } - execute migrations in array.
   *
   * @param {String|String[]|Object} options
   * @param {String}     [options.from] - The first migration to execute (exc).
   * @param {String}     [options.to] - The last migration to execute (inc).
   * @param {String[]}   [options.migrations] - List of migrations to execute.
   * @returns {Promise}
   */
  up(options) {
    return this._run('up', options, this.pending.bind(this));
  }

  /**
   * Execute migrations down.
   *
   * If options is a migration name (String), it will be executed.
   * If options is a list of migration names (String[]), them will be executed.
   * If options is Object:
   * - { from: 'migration-n', to: 'migration-1' } - execute migrations in range.
   * - { migrations: [] } - execute migrations in array.
   *
   * @param {String|String[]|Object} options
   * @param {String}     [options.from] - The first migration to execute (exc).
   * @param {String}     [options.to] - The last migration to execute (inc).
   * @param {String[]}   [options.migrations] - List of migrations to execute.
   * @returns {Promise}
   */
  down(options) {
    const getExecuted = function () {
      return this.executed().bind(this).then(migrations => migrations.reverse());
    }.bind(this);

    if (typeof options === 'undefined' || !(0, _keys2.default)(options).length) {
      return getExecuted().bind(this).then(function (migrations) {
        return migrations[0] ? this.down(migrations[0].file) : _bluebird2.default.resolve([]);
      });
    } else {
      return this._run('down', options, getExecuted.bind(this));
    }
  }

  /**
   * Callback function to get migrations in right order.
   *
   * @callback Umzug~rest
   * @return {Promise.<Migration[]>}
   */

  /**
   * Execute migrations either down or up.
   *
   * If options is a migration name (String), it will be executed.
   * If options is a list of migration names (String[]), them will be executed.
   * If options is Object:
   * - { from: 'migration-1', to: 'migration-n' } - execute migrations in range.
   * - { migrations: [] } - execute migrations in array.
   *
   * @param {String} method - Method to run. Either 'up' or 'down'.
   * @param {String|String[]|Object} options
   * @param {String}     [options.from] - The first migration to execute (exc).
   * @param {String}     [options.to] - The last migration to execute (inc).
   * @param {String[]}   [options.migrations] - List of migrations to execute.
   * @param {Umzug~rest} [rest] - Function to get migrations in right order.
   * @returns {Promise}
   * @private
   */
  _run(method, options, rest) {
    if (typeof options === 'string') {
      return this._run(method, [options]);
    } else if (Array.isArray(options)) {
      return _bluebird2.default.resolve(options).bind(this).map(function (migration) {
        return this._findMigration(migration);
      }).then(function (migrations) {
        return method === 'up' ? this._arePending(migrations) : this._wereExecuted(migrations);
      }).then(function () {
        return this._run(method, { migrations: options });
      });
    }

    options = (0, _extends3.default)({
      to: null,
      from: null,
      migrations: null
    }, options || {});

    if (options.migrations) {
      return this.execute({
        migrations: options.migrations,
        method: method
      });
    } else {
      return rest().bind(this).then(function (migrations) {
        let result = _bluebird2.default.resolve().bind(this);

        if (options.to) {
          result = result.then(function () {
            // There must be a migration matching to options.to...
            return this._findMigration(options.to);
          }).then(function (migration) {
            // ... and it must be pending/executed.
            return method === 'up' ? this._isPending(migration) : this._wasExecuted(migration);
          });
        }

        return result.then(() => _bluebird2.default.resolve(migrations));
      }).then(function (migrations) {
        if (options.from) {
          return this._findMigrationsFromMatch(options.from, method);
        } else {
          return migrations;
        }
      }).then(function (migrations) {
        return this._findMigrationsUntilMatch(options.to, migrations);
      }).then(function (migrationFiles) {
        return this._run(method, { migrations: migrationFiles });
      });
    }
  }

  /**
   * Lists pending/executed migrations depending on method from a given
   * migration excluding it.
   *
   * @param {String} from - Migration name to be searched.
   * @param {String} method - Either 'up' or 'down'. If method is 'up', only
   * pending migrations will be accepted. Otherwise only executed migrations
   * will be accepted.
   * @returns {Promise.<Migration[]>}
   * @private
   */
  _findMigrationsFromMatch(from, method) {
    // We'll fetch all migrations and work our way from start to finish
    return this._findMigrations().bind(this).then(migrations => {
      let found = false;
      return migrations.filter(migration => {
        if (migration.testFileName(from)) {
          found = true;
          return false;
        }
        return found;
      });
    }).filter(function (fromMigration) {
      // now check if they need to be run based on status and method
      return this._wasExecuted(fromMigration).then(() => {
        if (method === 'up') {
          return false;
        } else {
          return true;
        }
      }).catch(() => {
        if (method === 'up') {
          return true;
        } else {
          return false;
        }
      });
    });
  }

  /**
   * Pass message to logger if logging is enabled.
   *
   * @param {*} message - Message to be logged.
   */
  log(message) {
    if (this.options.logging) {
      this.options.logging(message);
    }
  }

  /**
   * Try to require and initialize storage.
   *
   * @returns {*|SequelizeStorage|JSONStorage|MongoDBStorage|Storage}
   * @private
   */
  _initStorage(storageAdapter, options) {
    if (typeof storageAdapter !== 'string') {
      return storageAdapter;
    }

    let StorageClass;
    try {
      StorageClass = this._getStorageClass(storageAdapter);
    } catch (e) {
      throw new Error('Unable to resolve the storage: ' + storageAdapter + ', ' + e);
    }

    let storage = new StorageClass(options);
    if (storage && storage.options && storage.options.storageOptions) {
      console.warn('Deprecated: Umzug Storage constructor has changed!', 'old syntax: new Storage({ storageOptions: { ... } })', 'new syntax: new Storage({ ... })', 'where ... represents the same storageOptions passed to Umzug constructor.', 'For more information: https://github.com/sequelize/umzug/pull/137');
      storage = new StorageClass(this.options);
    }

    return storage;
  }

  _getStorageClass(storageAdapter) {
    switch (storageAdapter) {
      case 'none':
        return _Storage2.default;
      case 'json':
        return _JSONStorage2.default;
      case 'mongodb':
        return _MongoDBStorage2.default;
      case 'sequelize':
        return _SequelizeStorage2.default;
      default:
        return require(storageAdapter);
    }
  }

  /**
   * Loads all migrations in ascending order.
   *
   * @returns {Promise.<Migration[]>}
   * @private
   */
  _findMigrations() {
    if (this.options.migrationInstances) {
      return _bluebird2.default.resolve(this.options.migrationInstances);
    }

    return _bluebird2.default.map(this.options.migrations, migrationOptions => this._loadMigrationGroup(migrationOptions)).then(migrationGroups => migrationGroups.reduce((flattened, group) => flattened.concat(group)).sort(function (a, b) {
      if (a.file > b.file) {
        return 1;
      } else if (a.file < b.file) {
        return -1;
      } else {
        return 0;
      }
    }));
  }

  /**
   * Load a set of migration files from a given folder with a given config
   *
   * @param {Object} migrationOptions - options for this group of migrations
   * @returns {Promise.<Migration[]>}
   * @private
   */
  _loadMigrationGroup(migrationOptions) {
    const migrationPath = migrationOptions.path;
    return _bluebird2.default
    // .promisify(fs.readdir)(migrationPath)
    .promisify(_glob2.default)(migrationPath).map(file => {
      let filePath = _path2.default.resolve(file);
      if (migrationOptions.traverseDirectories) {
        if (_fs2.default.lstatSync(filePath).isDirectory()) {
          return this._loadMigrationGroup((0, _extends3.default)({}, migrationOptions, {
            path: filePath
          }));
        }
      }
      if (migrationOptions.pattern.test(file)) {
        return new _migration3.default(filePath, (0, _extends3.default)({}, migrationOptions, {
          upName: this.options.upName,
          downName: this.options.downName
        }));
      }
      this.log('File: ' + file + ' does not match pattern: ' + migrationOptions.pattern);
      return file;
    }).reduce((a, b) => a.concat(b), []) // flatten the result to an array
    .filter(file => file instanceof _migration3.default); // only care about Migration
  }

  /**
   * Gets a migration with a given name.
   *
   * @param {String} needle - Name of the migration.
   * @returns {Promise.<Migration>}
   * @private
   */
  _findMigration(needle) {
    return this._findMigrations().then(migrations => migrations.filter(migration => migration.testFileName(needle))[0]).then(migration => {
      if (migration) {
        return migration;
      } else {
        return _bluebird2.default.reject(new Error('Unable to find migration: ' + needle));
      }
    });
  }

  /**
   * Checks if migration is executed. It will success if and only if there is
   * an executed migration with a given name.
   *
   * @param {String} _migration - Name of migration to be checked.
   * @returns {Promise}
   * @private
   */
  _wasExecuted(_migration) {
    return this.executed().filter(migration => migration.testFileName(_migration.file)).then(migrations => {
      if (migrations[0]) {
        return _bluebird2.default.resolve();
      } else {
        return _bluebird2.default.reject(new Error('Migration was not executed: ' + _migration.file));
      }
    });
  }

  /**
   * Checks if a list of migrations are all executed. It will success if and
   * only if there is an executed migration for each given name.
   *
   * @param {String[]} migrationNames - List of migration names to be checked.
   * @returns {Promise}
   * @private
   */
  _wereExecuted(migrationNames) {
    return _bluebird2.default.resolve(migrationNames).bind(this).map(function (migration) {
      return this._wasExecuted(migration);
    });
  }

  /**
   * Checks if migration is pending. It will success if and only if there is
   * a pending migration with a given name.
   *
   * @param {String} _migration - Name of migration to be checked.
   * @returns {Promise}
   * @private
   */
  _isPending(_migration) {
    return this.pending().filter(migration => migration.testFileName(_migration.file)).then(migrations => {
      if (migrations[0]) {
        return _bluebird2.default.resolve();
      } else {
        return _bluebird2.default.reject(new Error('Migration is not pending: ' + _migration.file));
      }
    });
  }

  /**
   * Checks if a list of migrations are all pending. It will success if and only
   * if there is a pending migration for each given name.
   *
   * @param {String[]} migrationNames - List of migration names to be checked.
   * @returns {Promise}
   * @private
   */
  _arePending(migrationNames) {
    return _bluebird2.default.resolve(migrationNames).bind(this).map(function (migration) {
      return this._isPending(migration);
    });
  }

  /**
   * Skip migrations in a given migration list after `to` migration.
   *
   * @param {String} to - The last one migration to be accepted.
   * @param {Migration[]} migrations - Migration list to be filtered.
   * @returns {Promise.<String>} - List of migrations before `to`.
   * @private
   */
  _findMigrationsUntilMatch(to, migrations) {
    return _bluebird2.default.resolve(migrations).map(migration => migration.file).reduce((acc, migration) => {
      if (acc.add) {
        acc.migrations.push(migration);

        if (to && migration.indexOf(to) === 0) {
          // Stop adding the migrations once the final migration
          // has been added.
          acc.add = false;
        }
      }

      return acc;
    }, { migrations: [], add: true }).get('migrations');
  }
};