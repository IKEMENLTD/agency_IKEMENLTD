/**
 * Production-safe logger utility
 *
 * In production:
 * - console.log, console.info, console.warn are disabled (security)
 * - console.error remains enabled (critical for debugging)
 *
 * In development:
 * - All logging is enabled
 */

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Safe logger that respects production environment
 */
const logger = {
    /**
     * Log general information (disabled in production)
     * @param  {...any} args
     */
    log: (...args) => {
        if (!IS_PRODUCTION) {
            console.log(...args);
        }
    },

    /**
     * Log informational messages (disabled in production)
     * @param  {...any} args
     */
    info: (...args) => {
        if (!IS_PRODUCTION) {
            console.info(...args);
        }
    },

    /**
     * Log warning messages (disabled in production)
     * @param  {...any} args
     */
    warn: (...args) => {
        if (!IS_PRODUCTION) {
            console.warn(...args);
        }
    },

    /**
     * Log error messages (ALWAYS enabled, even in production)
     * Errors are critical and should always be logged
     * @param  {...any} args
     */
    error: (...args) => {
        console.error(...args);
    },

    /**
     * Check if currently in development mode
     * @returns {boolean}
     */
    isDevelopment: () => !IS_PRODUCTION,

    /**
     * Check if currently in production mode
     * @returns {boolean}
     */
    isProduction: () => IS_PRODUCTION
};

module.exports = logger;
