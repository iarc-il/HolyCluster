import logging

logger = logging.getLogger(__name__)

class DummyRadioController:
    def init_radio(self):
        self.rig_type = "dummy"
        self.status_string = "I am a dummy"

    def set_mode(self, mode):
        pass

    def set_frequency(self, slot, freq):
        pass

    def get_data(self):
        pass


class OmnirigRadioController:
    def __init__(self):
        self.server = None
        self.omni_client = None
        self.current_rig = 1

    def init_radio(self):
        """initialize an omnipyrig instance and set active rig"""
        import omnipyrig

        self.omni_client = omnipyrig.OmniRigWrapper()
        # set the active rig to 1 (as defined in OmniRig GUI)
        self.omni_client.setActiveRig(1)
        self.rig_type = self.omni_client.getParam("RigType")
        self.status_string = self.omni_client.getParam("StatusStr")
        logger.debug(f"Rig type: {self.rig_type}, Status string: {self.status_string}")

    def set_mode(self, mode):
        mode_to_number = {
            "USB": 2,
            "LSB": 1,
            "FT8": 12,
            "FT4": 12,
            "DIGI": 12,
            "CW": 3,
        }
        self.omni_client.setMode(mode_to_number[mode])

    def set_rig(self, rig):
        """Set the active rig between rig 1 and rig 2

        Args:
        rig (int): Either 1 or 2
        """
        if rig != 1 and rig != 2:
            return

        self.current_rig = rig
        self.omni_client.setActiveRig(rig)

    def set_frequency(self, slot, freq):
        """Set the frequency of an omnirig slot.

        Args:
            slot (str): Either "A" or "B"
            freq (int): The frequency, in Khz. For example, 28500.
        """
        freq_in_hz = int(freq * 1000)
        self.omni_client.setFrequency("A", freq_in_hz)

    def get_data(self):
        """Get the current frequency, mode, and status of the radio"""
        freq = self.omni_client.getParam("FreqA")
        mode = self.omni_client.getParam("Mode")
        status = self.omni_client.getParam("StatusStr")

        number_to_mode = {
            "0x2000000": "SSB",
            "0x4000000": "SSB",
            "0x800000": "DIGI",
            "0x10000000": "DIGI",
            "0x0800000": "CW",
            "0x1000000": "CW",
        }

        return {
            "freq": freq,
            "mode": number_to_mode.get(mode, None),
            "status": "connected",
            "status_str": status,
            "current_rig": self.current_rig,
        }
