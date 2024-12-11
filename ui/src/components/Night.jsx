function Night({ is_active, size, on_click }) {
    return <svg
        onClick={on_click}
        height={size}
        width={size}
        className="cursor-pointer"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24" fill="none"
    >
        {is_active ?
            <>

                <path d="M12 3H12.393C11.1084 4.19371 10.2826 5.79985 10.0593 7.53923C9.83602 9.2786 10.2293 11.0412 11.1708 12.5207C12.1122 14.0002 13.5424 15.103 15.2126 15.6375C16.8829 16.1719 18.6876 16.1042 20.313 15.446C19.6878 16.9505 18.6658 18.257 17.3562 19.2263C16.0466 20.1955 14.4985 20.791 12.8769 20.9494C11.2554 21.1077 9.62129 20.823 8.14892 20.1254C6.67654 19.4279 5.42114 18.3437 4.51661 16.9886C3.61209 15.6335 3.09238 14.0583 3.01291 12.431C2.93345 10.8037 3.29721 9.1853 4.0654 7.74852C4.83359 6.31174 5.97739 5.11043 7.37479 4.27274C8.77219 3.43505 10.3708 2.9924 12 2.992V3Z" fill="#073F5F" stroke="#073F5F" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M19 11H20M20 11H21M20 11V10M20 11V12M17 4C17 4.53043 17.2107 5.03914 17.5858 5.41421C17.9609 5.78929 18.4696 6 19 6C18.4696 6 17.9609 6.21071 17.5858 6.58579C17.2107 6.96086 17 7.46957 17 8C17 7.46957 16.7893 6.96086 16.4142 6.58579C16.0391 6.21071 15.5304 6 15 6C15.5304 6 16.0391 5.78929 16.4142 5.41421C16.7893 5.03914 17 4.53043 17 4Z" stroke="#376FB1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />


            </>


            :
            <>
                <path d="M12 3H12.393C11.1084 4.19371 10.2826 5.79985 10.0593 7.53923C9.83602 9.2786 10.2293 11.0412 11.1708 12.5207C12.1122 14.0002 13.5424 15.103 15.2126 15.6375C16.8829 16.1719 18.6876 16.1042 20.313 15.446C19.6878 16.9505 18.6658 18.257 17.3562 19.2263C16.0466 20.1955 14.4985 20.791 12.8769 20.9494C11.2554 21.1077 9.62129 20.823 8.14892 20.1254C6.67654 19.4279 5.42114 18.3437 4.51661 16.9886C3.61209 15.6335 3.09238 14.0583 3.01291 12.431C2.93345 10.8037 3.29721 9.1853 4.0654 7.74852C4.83359 6.31174 5.97739 5.11043 7.37479 4.27274C8.77219 3.43505 10.3708 2.9924 12 2.992V3Z" stroke="#484848" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M19 11H20M20 11H21M20 11V10M20 11V12M17 4C17 4.53043 17.2107 5.03914 17.5858 5.41421C17.9609 5.78929 18.4696 6 19 6C18.4696 6 17.9609 6.21071 17.5858 6.58579C17.2107 6.96086 17 7.46957 17 8C17 7.46957 16.7893 6.96086 16.4142 6.58579C16.0391 6.21071 15.5304 6 15 6C15.5304 6 16.0391 5.78929 16.4142 5.41421C16.7893 5.03914 17 4.53043 17 4Z" stroke="#484848" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </>



        }
    </svg>
}

export default Night;
