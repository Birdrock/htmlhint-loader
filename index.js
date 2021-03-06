'use strict';

const path = require('path');
const fs = require('fs');
const HTMLHint = require('htmlhint').HTMLHint;
const loaderUtils = require('loader-utils');
const chalk = require('chalk');
const stripBom = require('strip-bom');
const glob = require('glob');

function formatMessage(message) {
  let evidence = message.evidence;
  const line = message.line;
  const col = message.col;
  const detail = typeof message.line === 'undefined' ?
    chalk.yellow('GENERAL') : `${chalk.yellow('L' + line)}${chalk.red(':')}${chalk.yellow('C' + col)}`;

  if (col === 0) {
    evidence = chalk.red('?') + evidence;
  } else if (col > evidence.length) {
    evidence = chalk.red(evidence + ' ');
  } else {
    evidence = `${evidence.slice(0, col - 1)}${chalk.red(evidence[col - 1])}${evidence.slice(col)}`;
  }

  return {
    message: `${chalk.red('[')}${detail}${chalk.red(']')}${chalk.yellow(' ' + message.message)} (${message.rule.id})`,
    evidence: evidence // eslint-disable-line object-shorthand
  };
}

function defaultFormatter(messages) {
  let output = '';

  messages.forEach(message => {
    const formatted = formatMessage(message);
    output += formatted.message + '\n';
    output += formatted.evidence + '\n';
  });

  return output.trim();
}

function loadCustomRules(options) {
  let rulesDir = options.rulesDir.replace(/\\/g, '/');
  if (fs.existsSync(rulesDir)) {
    if (fs.statSync(rulesDir).isDirectory()) {
      rulesDir += /\/$/.test(rulesDir) ? '' : '/';
      rulesDir += '**/*.js';
      glob.sync(rulesDir, {
        dot: false,
        nodir: true,
        strict: false,
        silent: true
      }).forEach(file => {
        loadRule(file, options);
      });
    } else {
      loadRule(rulesDir, options);
    }
  }
}

function loadRule(filepath, options) {
  options = options || {};
  filepath = path.resolve(filepath);
  const ruleObj = require(filepath); // eslint-disable-line import/no-dynamic-require
  const ruleOption = options[ruleObj.id]; // We can pass a value to the rule
  ruleObj.rule(HTMLHint, ruleOption);
}

function lint(source, options, webpack, done) {
  try {
    if (options.customRules) {
      options.customRules.forEach(rule => HTMLHint.addRule(rule));
    }
    if (options.rulesDir) {
      loadCustomRules(options);
    }

    const report = HTMLHint.verify(source, options);
    if (report.length > 0) {
      const reportByType = {
        warning: report.filter(message => message.type === 'warning'),
        error: report.filter(message => message.type === 'error')
      };

      // Add filename for each results so formatter can have relevant filename
      report.forEach(r => {
        r.filePath = webpack.resourcePath;
      });

      const messages = options.formatter(report);
      if (options.outputReport && options.outputReport.filePath) {
        let reportOutput;
        // If a different formatter is passed in as an option use that
        if (options.outputReport.formatter) {
          reportOutput = options.outputReport.formatter(report);
        } else {
          reportOutput = messages;
        }
        const filePath = loaderUtils.interpolateName(webpack, options.outputReport.filePath, {
          content: report.map(r => r.filePath).join('\n')
        });
        webpack.emitFile(filePath, reportOutput);
      }

      let emitter = reportByType.error.length > 0 ? webpack.emitError : webpack.emitWarning;
      if (options.emitAs === 'error') {
        emitter = webpack.emitError;
      } else if (options.emitAs === 'warning') {
        emitter = webpack.emitWarning;
      }

      emitter(new Error(options.formatter(report)));

      if (reportByType.error.length > 0 && options.failOnError) {
        throw new Error('Module failed because of a htmlhint error.');
      }

      if (reportByType.warning.length > 0 && options.failOnWarning) {
        throw new Error('Module failed because of a htmlhint warning.');
      }
    }

    done(null, source);
  } catch (err) {
    done(err);
  }
}

module.exports = function (source) {
  const DEFAULT_CONFIG_FILE = '.htmlhintrc';
  const options = Object.assign(
    {  // Loader defaults
      formatter: defaultFormatter,
      emitAs: null, // Can be either warning or error
      failOnError: false,
      failOnWarning: false,
      customRules: [],
      configFile: DEFAULT_CONFIG_FILE
    },
    this.options.htmlhint || {}, // User defaults
    loaderUtils.getOptions(this) // Loader query string
  );

  this.cacheable();

  const done = this.async();

  let configFilePath = options.configFile;
  if (!path.isAbsolute(configFilePath)) {
    configFilePath = path.join(process.cwd(), configFilePath);
  }

  fs.exists(configFilePath, exists => {
    if (exists) {
      fs.readFile(configFilePath, 'utf8', (err, configString) => {
        if (err) {
          done(err);
        } else {
          try {
            const htmlHintConfig = JSON.parse(stripBom(configString));
            lint(source, Object.assign(options, htmlHintConfig), this, done);
          } catch (err) {
            done(new Error('Could not parse the htmlhint config file'));
          }
        }
      });
    } else {
      if (configFilePath !== path.join(process.cwd(), DEFAULT_CONFIG_FILE)) {
        console.warn(`Could not find htmlhint config file in ${configFilePath}`);
      }
      lint(source, options, this, done);
    }
  });
};
