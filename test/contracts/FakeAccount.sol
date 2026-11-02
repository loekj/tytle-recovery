// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.8.20;

interface IGuardianStorage {
    function addGuardianWithThreshold(address guardian, uint256 threshold) external;
}

/// For the tests: a contract that is not a Safe but answers like one, and
/// writes a GuardianAdded record that names any guardian. Anybody can deploy
/// one, so the page's account search must not trust such a record.
contract FakeAccount {
    string public constant VERSION = "1.4.1";

    function isModuleEnabled(address) external pure returns (bool) {
        return true;
    }

    function isOwner(address) external pure returns (bool) {
        return false;
    }

    function getOwners() external pure returns (address[] memory owners) {
        owners = new address[](1);
        owners[0] = address(0xdEaD);
    }

    function getStorageAt(uint256, uint256 length) external pure returns (bytes memory) {
        return new bytes(length * 32);
    }

    function addGuardian(address module, address guardian) external {
        IGuardianStorage(module).addGuardianWithThreshold(guardian, 1);
    }
}
