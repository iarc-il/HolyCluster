/* Append and optionally snapshot under one lock. Never call logging while locked. */
static void save_debug_message(const char *s, char *snapshot)
{
    const char *p;
    char stmp[DEBUGMSGSAVE_SIZE];
    int i, nlines;
    size_t overflow_length = 0;
    size_t add_length = strlen(s);
    int overflow = 0;
    int maxmsg = DEBUGMSGSAVE_SIZE / 2;
    MUTEX_LOCK(mutex_debugmsgsave);
    memset(stmp, 0, sizeof(stmp));

    // we'll keep 20 lines including this one
    // so count the lines
    for (i = 0, nlines = 0; debugmsgsave[i] != 0; ++i)
    {
        if (debugmsgsave[i] == '\n') { ++nlines; }
    }

    // strip the last 19 lines
    p =  debugmsgsave;

    while ((nlines > 19 || strlen(debugmsgsave) > maxmsg) && p != NULL)
    {
        p = strchr(debugmsgsave, '\n');

        if (p && strlen(p + 1) > 0)
        {
            strcpy(stmp, p + 1);
            strcpy(debugmsgsave, stmp);
        }
        else
        {
            debugmsgsave[0] = '\0';
        }

        --nlines;

        if (nlines == 0 && strlen(debugmsgsave) > maxmsg) { strcpy(debugmsgsave, "!!!!debugmsgsave too long\n"); }
    }

    if (strlen(debugmsgsave) + add_length + 1 < DEBUGMSGSAVE_SIZE)
    {
        strcat(debugmsgsave, s);
    }
    else
    {
        overflow = 1;
        overflow_length = strlen(debugmsgsave);
    }

    if (snapshot != NULL)
    {
        memcpy(snapshot, debugmsgsave, strlen(debugmsgsave) + 1);
    }
    MUTEX_UNLOCK(mutex_debugmsgsave);

    if (overflow)
    {
        /* Bypass the history macro: overflow must not recursively append. */
        (rig_debug)(RIG_DEBUG_BUG,
                    "add2debugmsgsave: debugmsgsave overflow!! len of debugmsgsave=%d, len of add=%d\n",
                    (int)overflow_length, (int)add_length);
    }
}

void add2debugmsgsave(const char *s)
{
    save_debug_message(s, NULL);
}

void hamlib_debug_history_clear(void)
{
    MUTEX_LOCK(mutex_debugmsgsave);
    debugmsgsave[0] = debugmsgsave2[0] = debugmsgsave3[0] = 0;
    MUTEX_UNLOCK(mutex_debugmsgsave);
}


/**
 * \brief Get the string describing the passed error code.
 *
 * Simple version of rigerror() as it only outputs a short predefined string.
 *
 * \param errnum The error code defined in #rig_errcode_e, e.g. RIG_OK.
 *
 * \return The matched description string from `rigerror_table`, otherwise
 * `"ERR_OUT_OF_RANGE"` if `errnum` exceeds the number of strings defined in
 * `rigerror_table`.
 *
 * \todo Support gettext/localization
 */
const char *HAMLIB_API rigerror2(int errnum) // returns single-line message
{
    errnum = abs(errnum);

    if (errnum >= ERROR_TBL_SZ)
    {
        // This should not happen, but if it happens don't return NULL
        return "ERR_OUT_OF_RANGE";
    }

    static __thread char msg[DEBUGMSGSAVE_SIZE / 2];
    snprintf(msg, sizeof(msg), "%s\n", rigerror_table[errnum]);
    return msg;
}


/**
 * @brief Add error message to debug output.
 *
 * \param errnum The error code defined in #rig_errcode_e, e.g. RIG_OK.
 *
 * @return Pointer to the complete debug output otherwise `"ERR_OUT_OF_RANGE"`
 * if `errnum` exceeds the number of strings defined in `rigerror_table`.
 *
 * @sa add2debugmsgsave()
 *
 * \todo Support gettext/localization
 */
const char *HAMLIB_API rigerror(int errnum)
{
    errnum = abs(errnum);

    if (errnum >= ERROR_TBL_SZ)
    {
        // This should not happen, but if it happens don't return NULL
        return "ERR_OUT_OF_RANGE";
    }

    static __thread char msg[DEBUGMSGSAVE_SIZE];
    snprintf(msg, sizeof(msg), "%s\n", rigerror_table[errnum]);
    save_debug_message(msg, msg);
    return msg;
}
