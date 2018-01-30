var async = require('async');

var keystone = require('../../');
var _ = require('lodash');
var utils = require('keystone-utils');

module.exports = function autokey () {

	var autokey = this.autokey = _.clone(this.get('autokey'));
	var def = {};
	var list = this;

	if (!autokey.from) {
		var fromMsg = 'Invalid List Option (autokey) for ' + list.key + ' (from is required)\n';
		throw new Error(fromMsg);
	}
	if (!autokey.path) {
		var pathMsg = 'Invalid List Option (autokey) for ' + list.key + ' (path is required)\n';
		throw new Error(pathMsg);
	}

	if (typeof autokey.from === 'string') {
		autokey.from = autokey.from.split(' ');
	}

	autokey.from = autokey.from.map(function (i) {
		i = i.split(':');
		const format = i[1];
		var path = i[0];
		var child;

		i = path.split('.');
		if (i.length > 1) {
			path = i[0];
			child = i[1];
		}

		return { path, format, child };
	});

	def[autokey.path] = {
		type: String,
		index: true,
	};

	if (autokey.unique) {
		def[autokey.path].index = { unique: true };
	}

	this.schema.add(def);

	var getUniqueKey = function (doc, src, callback) {

		var q = list.model.find().where(autokey.path, src);

		if (_.isObject(autokey.unique)) {
			_.forEach(autokey.unique, function (k, v) {
				if (typeof v === 'string' && v.charAt(0) === ':') {
					q.where(k, doc.get(v.substr(1)));
				} else {
					q.where(k, v);
				}
			});
		}

		q.exec(function (err, results) {

			if (err) {
				callback(err);
			// deliberate use of implicit type coercion with == because doc.id may need to become a String
			} else if (results.length && (results.length > 1 || results[0].id != doc.id)) { // eslint-disable-line eqeqeq
				var inc = src.match(/^(.+)\-(\d+)$/);
				if (inc && inc.length === 3) {
					src = inc[1];
					inc = '-' + ((inc[2] * 1) + 1);
				} else {
					inc = '-1';
				}
				return getUniqueKey(doc, src + inc, callback);
			} else {
				doc.set(autokey.path, src);
				return callback();
			}
		});
	};

	this.schema.pre('save', function (next) {

		var modified = false;
		var incomplete = false;
		var values = [];

		var context = this;

		// loop over autokey fields (and load related objects if we need to)
		async.forEachOfSeries(autokey.from, function (ops, key, callback) {

			if (list.fields[ops.path]) {

				// consider relationship fields as always modified as we can't be sure of the previous value
				if (list.fields[ops.path].isModified(context) || (list.fields[ops.path].type === 'relationship' && ops.child)) {
					modified = true;
				}
				// if source field is neither selected nor modified we don't have a way to generate a complete autokey
				else if (!context.isSelected(ops.path)) {
					incomplete = true;
				}

				// make sure this field is a 1:1
				if (list.fields[ops.path].type === 'relationship' && !list.fields[ops.path].many && ops.child) {
					// make sure the refrenced object isn't null (if it is skip this key)
					if (context[ops.path]) {
						// query the related object
						keystone.list(list.fields[ops.path].options.ref).model.findOne(context.get(ops.path)).exec((err, result) => {
							if (!err) {
								values.push(result[ops.child]);
							}
							callback();
						});
					} else {
						callback();
					}

				} else {
					values.push(list.fields[ops.path].format(context, ops.format));
					callback();
				}

			} else {
				values.push(context.get(ops.path));
				// virtual paths are always assumed to have changed, except 'id'
				if (ops.path !== 'id' && list.schema.pathType(ops.path) === 'virtual' || context.isModified(ops.path)) {
					modified = true;
				}
				callback();
			}

		}, function (err) {

			if (err) console.error(err.message);

			// if source fields are not completely selected or set, skip generation unless told to ignore the condition
			if (incomplete && !autokey.ingoreIncompleteSource) {
				return next();
			}

			// if has a value and is unmodified or fixed, don't update it
			if ((!modified || autokey.fixed) && (context.get(autokey.path) || !context.isSelected(autokey.path))) {
				return next();
			}
			var newKey = utils.slug(values.join(' '), null, { locale: autokey.locale }) || context.id;
			if (autokey.unique) {
				return getUniqueKey(context, newKey, next);
			} else {
				context.set(autokey.path, newKey);
				return next();
			}

		})


	});

};
