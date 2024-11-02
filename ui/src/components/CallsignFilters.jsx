import CallsignsModal from "@/components/CallsignsModal.jsx";

function Filter({ size, color }) {
    return <svg
        fill={color}
        height={size}
        width={size}
        viewBox="0 0 512 512"
        className="cursor-pointer"
    >
        <path d="M468.557,24.603H43.443C19.488,24.603,0,44.091,0,68.045v12.856c0,23.954,19.488,43.442,43.443,43.442H63.86
            c20.218,26.78,105.227,134.278,125.646,161.381v188.375c0,4.813,2.6,9.251,6.798,11.602c2.023,1.133,4.262,1.697,6.5,1.697
            c2.41,0,4.817-0.654,6.946-1.958l118.358-72.478c3.947-2.418,6.353-6.713,6.353-11.341V285.724
            c20.419-27.103,105.428-134.602,125.646-161.381h8.449c23.955,0,43.443-19.488,43.443-43.443V68.044
            C512,44.091,492.512,24.603,468.557,24.603z M307.865,394.169l-91.761,56.191V294.566h91.761V394.169z M314.528,267.969H209.441
            c-20.218-26.778-95.797-122.325-112.159-143.626h329.402C410.325,145.643,334.746,241.191,314.528,267.969z M468.557,97.745
            H43.443c-9.288,0-16.845-7.556-16.845-16.845V68.044c0-9.288,7.558-16.844,16.845-16.844h425.114
            c9.288,0,16.845,7.556,16.845,16.845V80.9h0C485.403,90.188,477.845,97.745,468.557,97.745z"/>
    </svg>;
}

function CallsignFilters({ filtered_callsigns, set_filtered_callsigns }) {
    const color = filtered_callsigns.length > 0 ? "#00CC00" : "#212121";
    const exmaple_pattern_classes = "bg-slate-300 rounded-sm p-0.5";

    return <CallsignsModal
        callsigns={filtered_callsigns}
        set_callsigns={set_filtered_callsigns}
        button={<Filter size="32px" color={color}></Filter>}
        title="Filters"
        help_text={
            <small>
                You can filter out a pattern of a callsign. For example,<br/>
                Israeli stations: <code className={exmaple_pattern_classes}>4X*</code>,&nbsp;&nbsp;
                                  <code className={exmaple_pattern_classes}>4Z*</code><br/>
                Portable stations: <code className={exmaple_pattern_classes}>*/P</code><br/>
            </small>
        }
    />
}

export default CallsignFilters;
